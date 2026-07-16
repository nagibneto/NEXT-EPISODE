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
import { airedEpisodeCount, getMovieDetailsCached, getShowDetailsCached, posterUrl } from '@/lib/tmdb';

const FALLBACK_RUNTIME_MIN = 40;
const FALLBACK_MOVIE_RUNTIME_MIN = 110;

interface ShowStat {
  tmdb_show_id: number;
  name: string;
  poster_path: string | null;
  episodes: number;
  minutes: number;
  /** Tempo dos episódios já exibidos que ainda faltam assistir (0 = em dia). */
  remainingMinutes: number;
}

interface Stats {
  totalMinutes: number;
  tvMinutes: number;
  movieMinutes: number;
  totalEpisodes: number;
  totalShows: number;
  totalMovies: number;
  /** Todas as séries assistidas, das que mais consumiram tempo para as que menos. */
  shows: ShowStat[];
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

function formatDuration(totalMinutes: number) {
  const months = Math.floor(totalMinutes / (30 * 24 * 60));
  const days = Math.floor((totalMinutes % (30 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  return { months, days, hours, minutes };
}

/** Versão curta ("3d 14h", "5h 20min", "42 min") para as linhas e quadrinhos. */
function shortDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes} min`;
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
              // Reassistidos contam: 2x o filme = 2x a duração.
              const views = movie.watch_count ?? 1;
              try {
                const details = await getMovieDetailsCached(movie.tmdb_id);
                return (details.runtime || FALLBACK_MOVIE_RUNTIME_MIN) * views;
              } catch {
                return FALLBACK_MOVIE_RUNTIME_MIN * views;
              }
            })
          )
        ).reduce((acc, minutes) => acc + minutes, 0);
        const shows = await Promise.all(
          counts.map(async (count) => {
            // Tempo assistido conta as revisões; o "faltam assistir" continua
            // usando episódios distintos (rever não diminui o que falta).
            const views = count.view_count ?? count.episode_count;
            try {
              const details = await getShowDetailsCached(count.tmdb_show_id);
              const runtime = episodeRuntime(details);
              const remainingEpisodes = Math.max(
                airedEpisodeCount(details) - count.episode_count,
                0
              );
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: details.name,
                poster_path: details.poster_path,
                episodes: count.episode_count,
                minutes: views * runtime,
                remainingMinutes: remainingEpisodes * runtime,
              };
            } catch {
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: `Série #${count.tmdb_show_id}`,
                poster_path: null,
                episodes: count.episode_count,
                minutes: views * FALLBACK_RUNTIME_MIN,
                remainingMinutes: 0,
              };
            }
          })
        );
        if (cancelled) return;
        shows.sort((a, b) => b.minutes - a.minutes);
        const tvMinutes = shows.reduce((acc, show) => acc + show.minutes, 0);
        setStats({
          totalMinutes: tvMinutes + movieMinutes,
          tvMinutes,
          movieMinutes,
          totalEpisodes: shows.reduce((acc, show) => acc + show.episodes, 0),
          totalShows: shows.length,
          totalMovies: movies.length,
          shows,
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
          <ThemedText
            type="subtitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: theme.gold }}>
            {shortDuration(stats.tvMinutes)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tempo em séries
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="subtitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: theme.gold }}>
            {shortDuration(stats.movieMinutes)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tempo em filmes
          </ThemedText>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="subtitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: theme.gold }}>
            {stats.totalEpisodes.toLocaleString('pt-BR')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Episódios
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="subtitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: theme.gold }}>
            {stats.totalShows.toLocaleString('pt-BR')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Séries
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="subtitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: theme.gold }}>
            {stats.totalMovies.toLocaleString('pt-BR')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Filmes
          </ThemedText>
        </View>
      </View>

      {stats.shows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Tempo por série
          </ThemedText>
          {stats.shows.map((show) => {
            const poster = posterUrl(show.poster_path, 'w185');
            // A barra é o total já exibido da série: azul = assistido,
            // amarelo no final = o que ainda falta.
            const totalShowMinutes = show.minutes + show.remainingMinutes;
            const watchedShare =
              totalShowMinutes > 0 ? show.minutes / totalShowMinutes : 1;
            return (
              <Link
                key={show.tmdb_show_id}
                href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_show_id) } }}
                asChild>
                {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
                <Pressable
                  style={StyleSheet.flatten([
                    styles.showRow,
                    { backgroundColor: theme.backgroundElement },
                  ])}>
                  {poster ? (
                    <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.showInfo}>
                    <View style={styles.showName}>
                      <ThemedText
                        type="smallBold"
                        numberOfLines={1}
                        style={{ color: theme.accent, flexShrink: 1 }}>
                        {show.name}
                      </ThemedText>
                      <Ionicons name="chevron-forward" size={12} color={theme.accent} />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {show.episodes.toLocaleString('pt-BR')}{' '}
                      {show.episodes === 1 ? 'episódio' : 'episódios'} ·{' '}
                      {shortDuration(show.minutes)}
                    </ThemedText>
                    <View style={styles.barRow}>
                      <View
                        style={[styles.timeTrack, { backgroundColor: theme.backgroundSelected }]}>
                        <View
                          style={[
                            styles.timeFill,
                            {
                              backgroundColor: theme.accent,
                              width: `${Math.max(Math.round(watchedShare * 100), 2)}%`,
                            },
                          ]}
                        />
                        {show.remainingMinutes > 0 && (
                          <View style={[styles.timeFillRest, { backgroundColor: theme.gold }]} />
                        )}
                      </View>
                      {show.remainingMinutes > 0 && (
                        <ThemedText type="small" style={[styles.remaining, { color: theme.gold }]}>
                          faltam {shortDuration(show.remainingMinutes)}
                        </ThemedText>
                      )}
                    </View>
                  </View>
                </Pressable>
              </Link>
            );
          })}
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
  showName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: '100%',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  timeTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  timeFill: {
    height: '100%',
  },
  // O restinho amarelo preenche o que sobra da barra (tempo que falta).
  timeFillRest: {
    flex: 1,
    height: '100%',
  },
  remaining: {
    fontSize: 12,
  },
  note: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
});
