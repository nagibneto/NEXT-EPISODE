import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  getFriends,
  getFriendsEpisodeCounts,
  getFriendsMovieWatches,
  getProfile,
  profileDisplayName,
  type Profile,
} from '@/lib/db';
import { formatDuration, shortDuration } from '@/lib/duration';
import {
  episodeRuntime,
  FALLBACK_MOVIE_RUNTIME_MIN,
  FALLBACK_RUNTIME_MIN,
  getMovieDetailsCached,
  getShowDetailsCached,
  posterUrl,
} from '@/lib/tmdb';

/** Quantas séries listar; o suficiente para dar ideia do gosto sem virar uma lista infinita. */
const TOP_SHOWS = 10;

interface ShowStat {
  tmdb_show_id: number;
  name: string;
  poster_path: string | null;
  episodes: number;
  minutes: number;
}

interface UserStats {
  totalMinutes: number;
  totalEpisodes: number;
  totalShows: number;
  totalMovies: number;
  shows: ShowStat[];
}

/** Estatísticas públicas de um amigo, abertas ao tocar no avatar dele. */
export default function UserStatsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  /** null enquanto carrega; false esconde os números e explica o porquê. */
  const [canSee, setCanSee] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSelf = !!user && user.id === id;

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;

    (async () => {
      try {
        const [target, friends] = await Promise.all([getProfile(id), getFriends(user.id)]);
        if (cancelled) return;
        setProfile(target);

        // As RPCs respeitam a RLS e devolveriam vazio para quem não é amigo —
        // sem esta checagem a tela mostraria "0 min" como se a pessoa nunca
        // tivesse assistido nada.
        const allowed = isSelf || friends.some((f) => f.id === id);
        setCanSee(allowed);
        if (!allowed) return;

        const [episodeCounts, movieWatches] = await Promise.all([
          getFriendsEpisodeCounts([id], null),
          getFriendsMovieWatches([id], null),
        ]);

        const shows = await Promise.all(
          episodeCounts.map(async (count) => {
            try {
              const details = await getShowDetailsCached(count.tmdb_show_id);
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: details.name,
                poster_path: details.poster_path,
                episodes: count.episode_count,
                minutes: count.episode_count * episodeRuntime(details),
              };
            } catch {
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: `Série #${count.tmdb_show_id}`,
                poster_path: null,
                episodes: count.episode_count,
                minutes: count.episode_count * FALLBACK_RUNTIME_MIN,
              };
            }
          })
        );

        const movieMinutes = (
          await Promise.all(
            movieWatches.map(async (movie) => {
              try {
                const details = await getMovieDetailsCached(movie.tmdb_id);
                return details.runtime || FALLBACK_MOVIE_RUNTIME_MIN;
              } catch {
                return FALLBACK_MOVIE_RUNTIME_MIN;
              }
            })
          )
        ).reduce((acc, minutes) => acc + minutes, 0);

        if (cancelled) return;
        shows.sort((a, b) => b.minutes - a.minutes);
        setStats({
          totalMinutes: shows.reduce((acc, show) => acc + show.minutes, 0) + movieMinutes,
          totalEpisodes: shows.reduce((acc, show) => acc + show.episodes, 0),
          totalShows: shows.length,
          totalMovies: movieWatches.length,
          shows: shows.slice(0, TOP_SHOWS),
        });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Erro ao carregar as estatísticas.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, id, isSelf]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (canSee === null || (canSee && !stats)) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const name = profile ? profileDisplayName(profile) : '…';

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement }]}>
        <UserAvatar avatarId={profile?.avatar_id ?? null} name={name} size={64} />
        <ThemedText type="subtitle">{name}</ThemedText>
        {profile && (
          <ThemedText type="small" themeColor="textSecondary">
            @{profile.username}
          </ThemedText>
        )}
      </View>

      {!canSee ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={36} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={styles.message}>
            As estatísticas de {name} são visíveis só para amigos.
          </ThemedText>
        </View>
      ) : (
        stats && <StatsBody stats={stats} />
      )}
    </ScrollView>
  );
}

function StatsBody({ stats }: { stats: UserStats }) {
  const theme = useTheme();
  const duration = formatDuration(stats.totalMinutes);

  return (
    <>
      <View style={[styles.heroCard, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Tempo total assistido
        </ThemedText>
        <View style={styles.durationRow}>
          {duration.months > 0 && (
            <Block value={duration.months} label={duration.months === 1 ? 'mês' : 'meses'} />
          )}
          <Block value={duration.days} label={duration.days === 1 ? 'dia' : 'dias'} />
          <Block value={duration.hours} label="horas" />
          <Block value={duration.minutes} label="min" />
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatCard value={stats.totalEpisodes} label="Episódios" />
        <StatCard value={stats.totalShows} label="Séries" />
        <StatCard value={stats.totalMovies} label="Filmes" />
      </View>

      {stats.shows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Séries que mais assistiu
          </ThemedText>
          {stats.shows.map((show) => {
            const poster = posterUrl(show.poster_path, 'w185');
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
    </>
  );
}

function Block({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.durationBlock}>
      <ThemedText type="subtitle" style={{ color: theme.gold }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText
        type="subtitle"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ color: theme.gold }}>
        {value.toLocaleString('pt-BR')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
    flex: 1,
  },
  message: {
    textAlign: 'center',
  },
  header: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
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
  note: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
});
