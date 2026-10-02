import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import {
  addMovieToWatchlist,
  followShow,
  getFollowedShows,
  getWatchedMovies,
  getWatchlistMovies,
  removeMovieFromWatchlist,
  unfollowShow,
} from '@/lib/db';
import { syncEpisodeNotifications } from '@/lib/notifications';
import { getMovieNames, getShowNames } from '@/lib/tmdb';

export type QuickAddState = 'none' | 'listed' | 'done';

/**
 * Estado e ação do botão do canto do pôster: segue a série / põe o filme em
 * "Para assistir" (e desfaz no toque seguinte). Mesma regra do botão da aba
 * Buscar. Recarrega a coleção do usuário sempre que a tela ganha foco, para
 * refletir o que ele mudou nas telas de detalhe.
 */
export function useQuickAdd() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [followedIds, setFollowedIds] = useState<Set<number>>(new Set());
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());
  const [watchedMovieIds, setWatchedMovieIds] = useState<Set<number>>(new Set());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      Promise.all([
        getFollowedShows(user.id),
        getWatchlistMovies(user.id),
        getWatchedMovies(user.id),
      ])
        .then(([shows, watchlist, watched]) => {
          if (cancelled) return;
          setFollowedIds(new Set(shows.map((show) => show.tmdb_id)));
          setWatchlistIds(new Set(watchlist.map((movie) => movie.tmdb_id)));
          setWatchedMovieIds(new Set(watched.map((movie) => movie.tmdb_id)));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  function stateFor(media: 'tv' | 'movie', id: number): QuickAddState {
    if (media === 'movie' && watchedMovieIds.has(id)) return 'done';
    return (media === 'tv' ? followedIds : watchlistIds).has(id) ? 'listed' : 'none';
  }

  function isBusy(media: 'tv' | 'movie', id: number) {
    return busyKeys.has(`${media}-${id}`);
  }

  async function toggle(media: 'tv' | 'movie', item: { id: number; posterPath: string | null }) {
    const key = `${media}-${item.id}`;
    if (!user || busyKeys.has(key)) return;
    // Filme já assistido: o botão vira ✓ e não faz nada.
    if (media === 'movie' && watchedMovieIds.has(item.id)) return;
    const isTv = media === 'tv';
    const setIds = isTv ? setFollowedIds : setWatchlistIds;
    const alreadyIn = (isTv ? followedIds : watchlistIds).has(item.id);

    const flip = (add: boolean) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (add) next.add(item.id);
        else next.delete(item.id);
        return next;
      });

    setBusyKeys((prev) => new Set(prev).add(key));
    flip(!alreadyIn);
    try {
      if (isTv) {
        if (alreadyIn) {
          await unfollowShow(user.id, item.id);
        } else {
          const names = await getShowNames(item.id);
          await followShow(user.id, { tmdb_id: item.id, ...names, poster_path: item.posterPath });
        }
        syncEpisodeNotifications(user.id).catch(() => {});
      } else if (alreadyIn) {
        await removeMovieFromWatchlist(user.id, item.id);
      } else {
        const names = await getMovieNames(item.id);
        await addMovieToWatchlist(user.id, {
          tmdb_id: item.id,
          ...names,
          poster_path: item.posterPath,
        });
      }
    } catch {
      flip(alreadyIn); // desfaz o otimismo
      Alert.alert(t('search.followError'));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return { enabled: !!user, stateFor, isBusy, toggle };
}
