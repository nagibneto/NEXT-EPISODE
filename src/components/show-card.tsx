import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { posterUrl } from '@/lib/tmdb';

interface ShowCardProps {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  subtitle?: string;
}

export function ShowCard({ tmdbId, name, posterPath, subtitle }: ShowCardProps) {
  const theme = useTheme();
  const uri = posterUrl(posterPath);

  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(tmdbId) } }} asChild>
      <Pressable style={styles.card}>
        {uri ? (
          <Image source={{ uri }} style={styles.poster} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={3}>
              {name}
            </ThemedText>
          </View>
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {name}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: Spacing.two,
  },
  poster: {
    aspectRatio: 2 / 3,
    borderRadius: 12,
    width: '100%',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.two,
  },
  name: {
    marginTop: Spacing.one,
  },
});
