import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { WatchProviders } from '@/components/watch-providers';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  followShow,
  getWatchedEpisodes,
  isFollowing,
  markSeasonWatched,
  unfollowShow,
  unmarkSeasonWatched,
} from '@/lib/db';
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  backdropUrl,
  getSeasonAverageRatings,
  getSeasonDetailsCached,
  getShowDetails,
  posterUrl,
  type TmdbSeasonSummary,
  type TmdbShowDetails,
} from '@/lib/tmdb';

export default function ShowDetailsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);

  const [show, setShow] = useState<TmdbShowDetails | null>(null);
  const [seasonRatings, setSeasonRatings] = useState<Map<number, number>>(new Map());
  // season_number → episódios assistidos pelo usuário naquela temporada.
  const [watchedBySeason, setWatchedBySeason] = useState<Map<number, number>>(new Map());
  const [following, setFollowing] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Temporada com marcação em massa em andamento (número dela, ou null).
  const [seasonBusy, setSeasonBusy] = useState<number | null>(null);

  useEffect(() => {
    getShowDetails(showId)
      .then(setShow)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar a série.'));
    if (user) {
      isFollowing(user.id, showId)
        .then(setFollowing)
        .catch(() => setFollowing(false));
    }
  }, [showId, user]);

  // Revalida ao voltar da temporada: marcar um episódio lá passa a seguir a
  // série, e o botão "Seguindo" e as contagens por temporada precisam refletir.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      isFollowing(user.id, showId)
        .then(setFollowing)
        .catch(() => {});
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          const counts = new Map<number, number>();
          for (const episode of episodes) {
            counts.set(episode.season_number, (counts.get(episode.season_number) ?? 0) + 1);
          }
          setWatchedBySeason(counts);
        })
        .catch(() => {});
    }, [user, showId])
  );

  useEffect(() => {
    if (!show) return;
    const numbers = show.seasons
      .filter((season) => season.season_number > 0)
      .map((season) => season.season_number);
    if (numbers.length === 0) return;
    let cancelled = false;
    // A nota é um extra: se a busca falhar, a tela segue funcionando sem ela.
    getSeasonAverageRatings(show.id, numbers)
      .then((ratings) => {
        if (!cancelled) setSeasonRatings(ratings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show]);

  async function toggleFollow() {
    if (!user || !show || following === null) return;
    setBusy(true);
    try {
      if (following) {
        await unfollowShow(user.id, show.id);
        setFollowing(false);
      } else {
        await followShow(user.id, {
          tmdb_id: show.id,
          name: show.name,
          poster_path: show.poster_path,
        });
        setFollowing(true);
      }
      syncEpisodeNotifications(user.id).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar.');
    } finally {
      setBusy(false);
    }
  }

  /** Marca todos os episódios já exibidos da temporada, ou desmarca todos. */
  async function setSeasonWatched(season: TmdbSeasonSummary, watchAll: boolean) {
    if (!user || !show) return;
    setSeasonBusy(season.season_number);
    try {
      if (watchAll) {
        // Só episódios que já foram ao ar — igual à tela da temporada.
        const details = await getSeasonDetailsCached(show.id, season.season_number);
        const today = new Date().toISOString().slice(0, 10);
        const released = details.episodes
          .filter((episode) => !!episode.air_date && episode.air_date <= today)
          .map((episode) => episode.episode_number);
        await markSeasonWatched(user.id, show.id, season.season_number, released);
        setWatchedBySeason((prev) => new Map(prev).set(season.season_number, released.length));
        // Marcar assistido também passa a seguir a série, para ela aparecer
        // na watchlist (mesmo comportamento da tela da temporada).
        if (!following) {
          await followShow(user.id, {
            tmdb_id: show.id,
            name: show.name,
            poster_path: show.poster_path,
          });
          setFollowing(true);
        }
        syncEpisodeNotifications(user.id).catch(() => {});
      } else {
        await unmarkSeasonWatched(user.id, show.id, season.season_number);
        setWatchedBySeason((prev) => {
          const next = new Map(prev);
          next.delete(season.season_number);
          return next;
        });
      }
    } catch (err) {
      Alert.alert(
        'Não foi possível atualizar',
        err instanceof Error ? err.message : 'Tente novamente.'
      );
    } finally {
      setSeasonBusy(null);
    }
  }

  /** Toque na bolinha da temporada: marca tudo, ou confirma antes de desmarcar. */
  function onSeasonCheckPress(season: TmdbSeasonSummary, complete: boolean) {
    if (complete) {
      Alert.alert('Desmarcar temporada', `Desmarcar todos os episódios de ${season.name}?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desmarcar', style: 'destructive', onPress: () => setSeasonWatched(season, false) },
      ]);
    } else {
      setSeasonWatched(season, true);
    }
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!show) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const backdrop = backdropUrl(show.backdrop_path);
  const poster = posterUrl(show.poster_path, 'w185');
  const next = show.next_episode_to_air;
  const seasons = show.seasons.filter((season) => season.season_number > 0);

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: show.name }} />

      {backdrop && <Image source={{ uri: backdrop }} style={styles.backdrop} contentFit="cover" />}

      <View style={styles.header}>
        {poster && <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />}
        <View style={styles.headerText}>
          <ThemedText type="smallBold" style={styles.title}>
            {show.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {show.genres.map((genre) => genre.name).join(' · ')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {show.number_of_seasons} temporada{show.number_of_seasons === 1 ? '' : 's'} ·{' '}
            {show.number_of_episodes} episódios
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ⭐ {show.vote_average.toFixed(1)} (TMDB)
          </ThemedText>
        </View>
      </View>

      <Pressable
        style={[
          styles.followButton,
          {
            backgroundColor: following ? theme.backgroundElement : theme.accent,
            opacity: busy || following === null ? 0.6 : 1,
          },
        ]}
        disabled={busy || following === null}
        onPress={toggleFollow}>
        <ThemedText
          type="smallBold"
          style={{ color: following ? theme.text : theme.accentText }}>
          {following === null ? '…' : following ? '✓ Seguindo' : '+ Seguir série'}
        </ThemedText>
      </Pressable>

      <WatchProviders media="tv" tmdbId={show.id} style={styles.providers} />

      {next?.air_date && (
        <View style={[styles.nextEpisode, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Próximo episódio
          </ThemedText>
          <ThemedText type="small">
            S{String(next.season_number).padStart(2, '0')}E
            {String(next.episode_number).padStart(2, '0')}
            {next.name ? ` — ${next.name}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(`${next.air_date}T00:00:00`).toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
            })}
          </ThemedText>
        </View>
      )}

      {show.overview ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.overview}>
          {show.overview}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionTitle}>
        Temporadas
      </ThemedText>
      {seasons.map((season) => {
        const watchedCount = Math.min(
          watchedBySeason.get(season.season_number) ?? 0,
          season.episode_count
        );
        const complete = season.episode_count > 0 && watchedCount >= season.episode_count;
        return (
          <Link
            key={season.id}
            href={{
              pathname: '/show/[id]/season/[seasonNumber]',
              params: { id: String(show.id), seasonNumber: String(season.season_number) },
            }}
            asChild>
            <Pressable
              style={StyleSheet.flatten([styles.seasonRow, { backgroundColor: theme.backgroundElement }])}>
              <View style={styles.seasonText}>
                <ThemedText type="smallBold">{season.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {following || watchedBySeason.has(season.season_number)
                    ? `${watchedCount}/`
                    : ''}
                  {season.episode_count} episódios
                  {season.air_date ? ` · ${season.air_date.slice(0, 4)}` : ''}
                </ThemedText>
              </View>
              {seasonRatings.has(season.season_number) && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.seasonRating}>
                  ⭐ {seasonRatings.get(season.season_number)!.toFixed(1)}
                </ThemedText>
              )}
              <Pressable
                hitSlop={8}
                style={styles.seasonCheck}
                disabled={seasonBusy !== null}
                onPress={() => onSeasonCheckPress(season, complete)}>
                {seasonBusy === season.season_number ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Ionicons
                    name={complete ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={complete ? theme.accent : theme.textSecondary}
                  />
                )}
              </Pressable>
              <ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.six,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  backdrop: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  header: {
    flexDirection: 'row',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  poster: {
    width: 92,
    height: 138,
    borderRadius: 8,
    marginTop: -Spacing.five,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  followButton: {
    marginHorizontal: Spacing.three,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  providers: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
  },
  nextEpisode: {
    margin: Spacing.three,
    marginBottom: 0,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  overview: {
    padding: Spacing.three,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    fontSize: 18,
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  seasonText: {
    flex: 1,
    gap: Spacing.half,
  },
  seasonRating: {
    marginRight: Spacing.two,
  },
  seasonCheck: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.one,
  },
});
