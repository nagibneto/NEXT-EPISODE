import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getWatchedCounts, getWatchedMovies } from '@/lib/db';
import { getMovieDetailsCached, getShowDetailsCached, posterUrl } from '@/lib/tmdb';

const FALLBACK_RUNTIME_MIN = 40;
const FALLBACK_MOVIE_RUNTIME_MIN = 110;

interface ShowStat {
  tmdb_show_id: number;
  name: string;
  poster_path: string | null;
  episodes: number;
  minutes: number;
  /** Episódios já exibidos segundo a TMDB; null quando não deu para calcular. */
  aired: number | null;
}

interface Stats {
  totalMinutes: number;
  tvMinutes: number;
  movieMinutes: number;
  totalEpisodes: number;
  totalShows: number;
  totalMovies: number;
  topShows: ShowStat[];
  /** Séries com todos os episódios já exibidos assistidos. */
  finishedShows: ShowStat[];
  /** Séries com episódios exibidos ainda por assistir. */
  pendingShows: ShowStat[];
}

/** Duração típica de um episódio da série, com fallback quando a TMDB não informa. */
function episodeRuntime(details: {
  episode_run_time: number[];
  last_episode_to_air: { runtime: number | null } | null;
}) {
  if (details.episode_run_time.length > 0) {
    const sum = details.episode_run_time.reduce((acc, min) => acc + min, 0);
    return sum / details.episode_run_time.length;
  }
  return details.last_episode_to_air?.runtime || FALLBACK_RUNTIME_MIN;
}

/**
 * Quantos episódios da série já foram ao ar: temporadas anteriores completas
 * (especiais fora) + posição do último episódio exibido na temporada atual.
 * O number_of_episodes sozinho não serve porque inclui episódios anunciados
 * que ainda não estrearam.
 */
function airedEpisodeCount(details: {
  seasons: { season_number: number; episode_count: number }[];
  last_episode_to_air: { season_number: number; episode_number: number } | null;
  number_of_episodes: number;
}) {
  const last = details.last_episode_to_air;
  if (!last) return details.number_of_episodes;
  const previousSeasons = details.seasons
    .filter((s) => s.season_number > 0 && s.season_number < last.season_number)
    .reduce((acc, s) => acc + s.episode_count, 0);
  return previousSeasons + last.episode_number;
}

function formatDuration(totalMinutes: number) {
  const months = Math.floor(totalMinutes / (30 * 24 * 60));
  const days = Math.floor((totalMinutes % (30 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  return { months, days, hours, minutes };
}

/** Versão curta ("3d 14h", "5h 20min", "42 min") para os quadrinhos. */
function shortDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes} min`;
}

/** Linha clicável de série nas seções de finalizadas/pendentes. */
function ShowProgressRow({ show, finished }: { show: ShowStat; finished: boolean }) {
  const theme = useTheme();
  const poster = posterUrl(show.poster_path, 'w185');
  const progress =
    show.aired && show.aired > 0 ? Math.min(show.episodes / show.aired, 1) : null;
  const subtitle = finished
    ? `${Math.min(show.episodes, show.aired ?? show.episodes)} de ${show.aired} episódios`
    : show.aired
      ? `${show.episodes} de ${show.aired} episódios · faltam ${show.aired - show.episodes}`
      : `${show.episodes} episódios assistidos`;
  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_show_id) } }} asChild>
      <Pressable style={[styles.showRow, { backgroundColor: theme.backgroundElement }]}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.showInfo}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {show.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
          {!finished && progress !== null && (
            <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
          )}
        </View>
        {finished ? (
          <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
        ) : (
          <ThemedText themeColor="textSecondary">›</ThemedText>
        )}
      </Pressable>
    </Link>
  );
}

export default function StatsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const [counts, movies] = await Promise.all([
          getWatchedCounts(),
          getWatchedMovies(user.id),
        ]);
        const movieMinutes = (
          await Promise.all(
            movies.map(async (movie) => {
              try {
                const details = await getMovieDetailsCached(movie.tmdb_id);
                return details.runtime || FALLBACK_MOVIE_RUNTIME_MIN;
              } catch {
                return FALLBACK_MOVIE_RUNTIME_MIN;
              }
            })
          )
        ).reduce((acc, minutes) => acc + minutes, 0);
        const shows = await Promise.all(
          counts.map(async (count) => {
            try {
              const details = await getShowDetailsCached(count.tmdb_show_id);
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: details.name,
                poster_path: details.poster_path,
                episodes: count.episode_count,
                minutes: count.episode_count * episodeRuntime(details),
                aired: airedEpisodeCount(details),
              };
            } catch {
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: `Série #${count.tmdb_show_id}`,
                poster_path: null,
                episodes: count.episode_count,
                minutes: count.episode_count * FALLBACK_RUNTIME_MIN,
                aired: null,
              };
            }
          })
        );
        if (cancelled) return;
        shows.sort((a, b) => b.minutes - a.minutes);
        const tvMinutes = shows.reduce((acc, show) => acc + show.minutes, 0);
        const finishedShows = shows
          .filter((show) => show.aired !== null && show.aired > 0 && show.episodes >= show.aired)
          .sort((a, b) => a.name.localeCompare(b.name));
        const finishedIds = new Set(finishedShows.map((show) => show.tmdb_show_id));
        const pendingShows = shows
          .filter((show) => !finishedIds.has(show.tmdb_show_id))
          // As mais próximas de terminar primeiro.
          .sort((a, b) => b.episodes / (b.aired || Infinity) - a.episodes / (a.aired || Infinity));
        setStats({
          totalMinutes: tvMinutes + movieMinutes,
          tvMinutes,
          movieMinutes,
          totalEpisodes: shows.reduce((acc, show) => acc + show.episodes, 0),
          totalShows: shows.length,
          totalMovies: movies.length,
          topShows: shows.slice(0, 10),
          finishedShows,
          pendingShows,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao calcular as estatísticas.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Calculando seu tempo assistido…
        </ThemedText>
      </View>
    );
  }

  const duration = formatDuration(stats.totalMinutes);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.container}>
      <View style={[styles.heroCard, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Tempo total assistido
        </ThemedText>
        <View style={styles.durationRow}>
          {duration.months > 0 && (
            <View style={styles.durationBlock}>
              <ThemedText type="subtitle" style={{ color: theme.gold }}>
                {duration.months}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {duration.months === 1 ? 'mês' : 'meses'}
              </ThemedText>
            </View>
          )}
          <View style={styles.durationBlock}>
            <ThemedText type="subtitle" style={{ color: theme.gold }}>
              {duration.days}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {duration.days === 1 ? 'dia' : 'dias'}
            </ThemedText>
          </View>
          <View style={styles.durationBlock}>
            <ThemedText type="subtitle" style={{ color: theme.gold }}>
              {duration.hours}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              horas
            </ThemedText>
          </View>
          <View style={styles.durationBlock}>
            <ThemedText type="subtitle" style={{ color: theme.gold }}>
              {duration.minutes}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              min
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.gold }}>
            {shortDuration(stats.tvMinutes)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tempo em séries
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.gold }}>
            {shortDuration(stats.movieMinutes)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tempo em filmes
          </ThemedText>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.gold }}>
            {stats.totalEpisodes}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Episódios
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.gold }}>
            {stats.totalShows}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Séries
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.gold }}>
            {stats.totalMovies}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Filmes
          </ThemedText>
        </View>
      </View>

      {stats.topShows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Séries que mais consumiram seu tempo
          </ThemedText>
          {stats.topShows.map((show) => {
            const poster = posterUrl(show.poster_path, 'w185');
            const hours = Math.round(show.minutes / 60);
            return (
              <Link
                key={show.tmdb_show_id}
                href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_show_id) } }}
                asChild>
                <Pressable style={[styles.showRow, { backgroundColor: theme.backgroundElement }]}>
                  {poster ? (
                    <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.showInfo}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {show.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {show.episodes} {show.episodes === 1 ? 'episódio' : 'episódios'} ·{' '}
                      {hours > 0 ? `${hours}h` : `${Math.round(show.minutes)} min`}
                    </ThemedText>
                  </View>
                  <ThemedText themeColor="textSecondary">›</ThemedText>
                </Pressable>
              </Link>
            );
          })}
        </>
      )}

      {stats.pendingShows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Séries pendentes ({stats.pendingShows.length})
          </ThemedText>
          {stats.pendingShows.map((show) => (
            <ShowProgressRow key={show.tmdb_show_id} show={show} finished={false} />
          ))}
        </>
      )}

      {stats.finishedShows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Séries finalizadas ({stats.finishedShows.length})
          </ThemedText>
          {stats.finishedShows.map((show) => (
            <ShowProgressRow key={show.tmdb_show_id} show={show} finished />
          ))}
        </>
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        Tempo estimado com base na duração dos episódios e filmes informada pela TMDB.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
  },
  heroCard: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
  },
  durationRow: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  durationBlock: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  poster: {
    width: 44,
    height: 66,
    borderRadius: 8,
  },
  showInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: Spacing.half,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  note: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
});
