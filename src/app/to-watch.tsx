import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MediaGrid, type MediaGridItem } from '@/components/media-grid';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  getFollowedShows,
  getWatchedCounts,
  getWatchlistMovies,
} from '@/lib/db';

export default function ToWatchScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [items, setItems] = useState<MediaGridItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recarrega ao voltar de um título: marcar um episódio ou filme como
  // assistido (ou tirar da lista) muda o que pertence ao "Para assistir".
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      Promise.all([getFollowedShows(user.id), getWatchedCounts(), getWatchlistMovies(user.id)])
        .then(([shows, counts, movies]) => {
          // Série entra aqui quando é seguida sem nenhum episódio visto.
          const startedIds = new Set(
            counts.filter((count) => count.episode_count > 0).map((count) => count.tmdb_show_id)
          );
          const pendingShows: MediaGridItem[] = shows
            .filter((show) => !startedIds.has(show.tmdb_id))
            .map((show) => ({
              media: 'tv',
              tmdb_id: show.tmdb_id,
              title: show.name,
              poster_path: show.poster_path,
            }));
          const pendingMovies: MediaGridItem[] = movies.map((movie) => ({
            media: 'movie',
            tmdb_id: movie.tmdb_id,
            title: movie.title,
            poster_path: movie.poster_path,
          }));
          setItems([...pendingShows, ...pendingMovies]);
        })
        .catch((err) => setError(errorMessage(err, 'Erro ao carregar a lista.')));
    }, [user])
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

  return (
    <MediaGrid
      items={items}
      emptyTitle="Nada para assistir ainda"
      emptyText="Siga uma série (sem marcar episódios) ou adicione um filme em Para assistir para ele aparecer aqui."
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
});
