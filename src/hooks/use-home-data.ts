import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/use-auth';
import {
  getFollowedShows,
  getProfile,
  getWatchedCounts,
  getWatchlistMovies,
  markEpisodeWatched,
  profileDisplayName,
  type FollowedShow,
  type WatchlistMovie,
} from '@/lib/db';
import { loadFeaturedMovies, type FeaturedMovie } from '@/lib/home-featured';
import { getMovieReleaseDates } from '@/lib/movie-releases';
import { buildThisWeekItems, type NextAiring } from '@/lib/this-week';
import { getShowDetailsCached } from '@/lib/tmdb';
import { getNextUnwatchedEpisode, type NextEpisode } from '@/lib/watch-next';
import { readWatchlistCache } from '@/lib/watchlist-cache';
import { onWidgetWatchedSynced, scheduleWidgetRefresh } from '@/lib/widget-data';

export interface ContinueItem {
  show: FollowedShow;
  next: NextEpisode;
}

/** Séries candidatas ao "Continue assistindo" (as vistas mais recentemente). */
const CONTINUE_CANDIDATES = 12;
/** Quantas aparecem na faixa. */
const CONTINUE_MAX = 8;
const BATCH_SIZE = 6;

/**
 * Dados da aba Início: destaque, "Continue assistindo" e "Próximos". Cada bloco
 * carrega por conta própria — um que falha (ou demora) não segura os outros —
 * e os dois últimos abrem com o que a Watchlist deixou salvo no aparelho.
 */
export function useHomeData() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [firstName, setFirstName] = useState<string | null>(null);
  const [featured, setFeatured] = useState<FeaturedMovie[] | null>(null);
  const [continueItems, setContinueItems] = useState<ContinueItem[] | null>(null);
  const [shows, setShows] = useState<FollowedShow[]>([]);
  const [nextAirById, setNextAirById] = useState<Record<number, NextAiring | null>>({});
  const [movies, setMovies] = useState<WatchlistMovie[]>([]);
  const [movieReleaseById, setMovieReleaseById] = useState<Record<number, string | null>>({});
  // Conta logada no momento: resposta que chega depois de trocar de conta é descartada.
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const load = useCallback(async () => {
    if (!user) return;
    const userId = user.id;
    const stillCurrent = () => userIdRef.current === userId;

    const featuredTask = loadFeaturedMovies()
      .then((list) => {
        if (stillCurrent()) setFeatured(list);
      })
      // Sem rede na primeira carga: some com o esqueleto em vez de girar para sempre.
      .catch(() => setFeatured((prev) => prev ?? []));

    const moviesTask = (async () => {
      const watchlist = await getWatchlistMovies(userId);
      const dates = await getMovieReleaseDates(watchlist.map((movie) => movie.tmdb_id));
      if (!stillCurrent()) return;
      setMovies(watchlist);
      setMovieReleaseById(dates);
    })().catch(() => {});

    const showsTask = (async () => {
      const [followed, counts] = await Promise.all([getFollowedShows(userId), getWatchedCounts()]);
      if (!stillCurrent()) return;
      setShows(followed);

      // Próximo episódio anunciado de cada série, para a faixa "Próximos".
      const airingTask = Promise.all(
        followed.map(async (show) => {
          try {
            const upcoming = (await getShowDetailsCached(show.tmdb_id)).next_episode_to_air;
            return [
              show.tmdb_id,
              upcoming?.air_date
                ? {
                    airDate: upcoming.air_date,
                    seasonNumber: upcoming.season_number,
                    episodeNumber: upcoming.episode_number,
                  }
                : null,
            ] as const;
          } catch {
            return null; // mantém o que o cache já sabia desta série
          }
        })
      ).then((entries) => {
        if (!stillCurrent()) return;
        setNextAirById((prev) => {
          const next = { ...prev };
          for (const entry of entries) if (entry) next[entry[0]] = entry[1];
          return next;
        });
      });

      // "Continue assistindo": as séries em que o usuário mexeu por último e
      // que ainda têm episódio exibido por ver.
      const lastWatched = new Map(counts.map((count) => [count.tmdb_show_id, count.last_watched_at]));
      const candidates = followed
        .filter((show) => lastWatched.get(show.tmdb_id))
        .sort((a, b) =>
          lastWatched.get(b.tmdb_id)!.localeCompare(lastWatched.get(a.tmdb_id)!)
        )
        .slice(0, CONTINUE_CANDIDATES);
      const found: ContinueItem[] = [];
      for (let i = 0; i < candidates.length && found.length < CONTINUE_MAX; i += BATCH_SIZE) {
        const batch = await Promise.all(
          candidates.slice(i, i + BATCH_SIZE).map(async (show) => {
            try {
              const next = await getNextUnwatchedEpisode(userId, show.tmdb_id);
              return next ? { show, next } : null;
            } catch {
              return null;
            }
          })
        );
        for (const item of batch) if (item) found.push(item);
      }
      if (stillCurrent()) setContinueItems(found.slice(0, CONTINUE_MAX));
      await airingTask;
    })().catch(() => setContinueItems((prev) => prev ?? []));

    await Promise.all([featuredTask, moviesTask, showsTask]);
  }, [user]);

  // Abre com o que a Watchlist salvou: as faixas aparecem na hora e a rede
  // corrige por baixo.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getProfile(user.id)
      .then((profile) => {
        if (!cancelled && profile) setFirstName(profileDisplayName(profile).split(' ')[0]);
      })
      .catch(() => {});
    readWatchlistCache(user.id).then((cache) => {
      if (cancelled || !cache?.shows) return;
      const cachedShows = cache.shows;
      setShows((prev) => (prev.length ? prev : cachedShows));
      setNextAirById((prev) => ({ ...cache.nextAirById, ...prev }));
      setContinueItems((prev) => {
        if (prev) return prev;
        const lastWatched = cache.lastWatchedAtById ?? {};
        const items: ContinueItem[] = [];
        for (const show of cachedShows) {
          const next = cache.nextEpById?.[show.tmdb_id];
          if (next && lastWatched[show.tmdb_id]) items.push({ show, next });
        }
        if (items.length === 0) return prev;
        return items
          .sort((a, b) =>
            lastWatched[b.show.tmdb_id]!.localeCompare(lastWatched[a.show.tmdb_id]!)
          )
          .slice(0, CONTINUE_MAX);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // `language` na dependência: títulos, datas regionais e trailers mudam com o idioma.
  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, language])
  );

  // Marcou pelo widget da tela inicial: a faixa precisa andar sozinha.
  useEffect(() => onWidgetWatchedSynced(() => void load()), [load]);

  /** Marca o episódio da faixa como visto e põe o seguinte da série no lugar. */
  const markWatched = useCallback(
    async (item: ContinueItem) => {
      if (!user) return;
      const showId = item.show.tmdb_id;
      await markEpisodeWatched(
        user.id,
        showId,
        item.next.seasonNumber,
        item.next.episodeNumber,
        true
      );
      scheduleWidgetRefresh(user.id);
      const next = await getNextUnwatchedEpisode(user.id, showId).catch(() => null);
      setContinueItems((prev) =>
        (prev ?? []).flatMap((current) =>
          current.show.tmdb_id !== showId ? [current] : next ? [{ show: current.show, next }] : []
        )
      );
    },
    [user]
  );

  const upcomingItems = useMemo(
    () => buildThisWeekItems({ shows, nextAirById, movies, movieReleaseById, language, t }),
    [shows, nextAirById, movies, movieReleaseById, language, t]
  );

  return { firstName, featured, continueItems, upcomingItems, reload: load, markWatched };
}
