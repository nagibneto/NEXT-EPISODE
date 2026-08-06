import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { i18n } from '@/lib/i18n';
import { localizedTitle } from '@/lib/locale';

export default function ToWatchScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
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
              title: localizedTitle(show.name, show.name_en, i18n.language),
              poster_path: show.poster_path,
            }));
          const pendingMovies: MediaGridItem[] = movies.map((movie) => ({
            media: 'movie',
            tmdb_id: movie.tmdb_id,
            title: localizedTitle(movie.title, movie.title_en, i18n.language),
            poster_path: movie.poster_path,
          }));
          setItems([...pendingShows, ...pendingMovies]);
        })
        .catch((err) => setError(errorMessage(err, t('toWatch.loadError'))));
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
      emptyTitle={t('toWatch.emptyTitle')}
      emptyText={t('toWatch.emptyText')}
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
