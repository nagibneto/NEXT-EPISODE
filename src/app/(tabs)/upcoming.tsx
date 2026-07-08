import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getFollowedShows } from '@/lib/db';
import { getShowDetails, posterUrl, type TmdbEpisode } from '@/lib/tmdb';

interface UpcomingItem {
  showId: number;
  showName: string;
  posterPath: string | null;
  episode: TmdbEpisode;
}

function formatAirDate(airDate: string): string {
  const date = new Date(`${airDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Hoje! 🎉';
  if (diffDays === 1) return 'Amanhã';
  if (diffDays < 7) return `Em ${diffDays} dias`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function UpcomingScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const shows = await getFollowedShows(user.id);
      const details = await Promise.all(
        shows.map(async (show) => {
          try {
            return await getShowDetails(show.tmdb_id);
          } catch {
            return null;
          }
        })
      );
      const upcoming: UpcomingItem[] = [];
      for (const detail of details) {
        if (detail?.next_episode_to_air?.air_date) {
          upcoming.push({
            showId: detail.id,
            showName: detail.name,
            posterPath: detail.poster_path,
            episode: detail.next_episode_to_air,
          });
        }
      }
      upcoming.sort((a, b) => (a.episode.air_date! < b.episode.air_date! ? -1 : 1));
      setItems(upcoming);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar os próximos episódios.');
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (items === null && !error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.showId}-${item.episode.id}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.message}>
                Nada por enquanto
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Quando alguma das suas séries tiver um próximo episódio anunciado, ele aparece aqui.
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const poster = posterUrl(item.posterPath, 'w185');
            return (
              <Link
                href={{ pathname: '/show/[id]', params: { id: String(item.showId) } }}
                asChild>
                <Pressable
                  style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
                  {poster ? (
                    <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.showName}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      S{String(item.episode.season_number).padStart(2, '0')}E
                      {String(item.episode.episode_number).padStart(2, '0')}
                      {item.episode.name ? ` — ${item.episode.name}` : ''}
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {formatAirDate(item.episode.air_date!)}
                    </ThemedText>
                  </View>
                </Pressable>
              </Link>
            );
          }}
        />
      )}
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
    gap: Spacing.two,
    marginTop: Spacing.six,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
  },
  poster: {
    width: 64,
    height: 96,
  },
  rowText: {
    flex: 1,
    padding: Spacing.two,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  message: {
    textAlign: 'center',
  },
});
