import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getWatchedEpisodes, markEpisodeWatched } from '@/lib/db';
import { getSeasonDetails, stillUrl, type TmdbSeasonDetails } from '@/lib/tmdb';

export default function SeasonScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; seasonNumber: string }>();
  const showId = Number(params.id);
  const seasonNumber = Number(params.seasonNumber);

  const [season, setSeason] = useState<TmdbSeasonDetails | null>(null);
  const [watched, setWatched] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSeasonDetails(showId, seasonNumber)
      .then(setSeason)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar a temporada.')
      );
    if (user) {
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          setWatched(
            new Set(
              episodes
                .filter((episode) => episode.season_number === seasonNumber)
                .map((episode) => episode.episode_number)
            )
          );
        })
        .catch(() => {});
    }
  }, [showId, seasonNumber, user]);

  const toggleWatched = useCallback(
    async (episodeNumber: number) => {
      if (!user) return;
      const isWatched = watched.has(episodeNumber);
      // Atualização otimista: reflete o toque na hora e desfaz se a API falhar.
      setWatched((current) => {
        const next = new Set(current);
        if (isWatched) next.delete(episodeNumber);
        else next.add(episodeNumber);
        return next;
      });
      try {
        await markEpisodeWatched(user.id, showId, seasonNumber, episodeNumber, !isWatched);
      } catch {
        setWatched((current) => {
          const next = new Set(current);
          if (isWatched) next.add(episodeNumber);
          else next.delete(episodeNumber);
          return next;
        });
      }
    },
    [user, watched, showId, seasonNumber]
  );

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!season) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: season.name }} />
      <FlatList
        data={season.episodes}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const released = !!item.air_date && item.air_date <= today;
          const still = stillUrl(item.still_path);
          const isWatched = watched.has(item.episode_number);
          return (
            <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <Link
                href={{
                  pathname: '/episode/[showId]/[seasonNumber]/[episodeNumber]',
                  params: {
                    showId: String(showId),
                    seasonNumber: String(seasonNumber),
                    episodeNumber: String(item.episode_number),
                  },
                }}
                asChild>
                <Pressable style={styles.episodePressable}>
                  {still ? (
                    <Image source={{ uri: still }} style={styles.still} contentFit="cover" />
                  ) : (
                    <View style={[styles.still, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.episodeText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.episode_number}. {item.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {item.air_date
                        ? new Date(`${item.air_date}T00:00:00`).toLocaleDateString('pt-BR')
                        : 'Data não anunciada'}
                      {!released && ' · Em breve'}
                    </ThemedText>
                  </View>
                </Pressable>
              </Link>
              {released && (
                <Pressable
                  hitSlop={8}
                  style={styles.watchedButton}
                  onPress={() => toggleWatched(item.episode_number)}>
                  <Ionicons
                    name={isWatched ? 'checkmark-circle' : 'ellipse-outline'}
                    size={28}
                    color={isWatched ? theme.accent : theme.textSecondary}
                  />
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  episodePressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  still: {
    width: 100,
    height: 64,
  },
  episodeText: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    gap: Spacing.half,
  },
  watchedButton: {
    paddingHorizontal: Spacing.two,
  },
});
