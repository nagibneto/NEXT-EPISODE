import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { MediaGrid, type MediaGridItem } from '@/components/media-grid';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage, getFavorites } from '@/lib/db';
import { i18n } from '@/lib/i18n';
import { localizedTitle } from '@/lib/locale';

export default function FavoritesScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<MediaGridItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recarrega ao voltar de um título: a estrelinha pode ter mudado lá.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getFavorites(user.id)
        .then((favorites) =>
          setItems(
            favorites.map((favorite) => ({
              media: favorite.media_type,
              tmdb_id: favorite.tmdb_id,
              title: localizedTitle(favorite.title, favorite.title_en, i18n.language),
              poster_path: favorite.poster_path,
            }))
          )
        )
        .catch((err) => setError(errorMessage(err, t('favorites.loadError'))));
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
      emptyTitle={t('favorites.emptyTitle')}
      emptyText={t('favorites.emptyText')}
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
