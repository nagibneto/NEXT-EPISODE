import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getMovieCredits, getShowCredits, posterUrl, type TmdbCastMember } from '@/lib/tmdb';

/**
 * Elenco principal do título, em carrossel horizontal. Não renderiza nada
 * enquanto carrega ou quando o TMDB não tem essa informação — é um extra,
 * não pode quebrar a tela.
 */
export function CastList({ media, tmdbId }: { media: 'tv' | 'movie'; tmdbId: number }) {
  const theme = useTheme();
  const [cast, setCast] = useState<TmdbCastMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCast(null);
    const request = media === 'tv' ? getShowCredits(tmdbId) : getMovieCredits(tmdbId);
    request
      .then((data) => {
        if (!cancelled) setCast(data.cast.slice(0, 20));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [media, tmdbId]);

  if (!cast || cast.length === 0) return null;

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.title}>
        Elenco
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {cast.map((member) => {
          const photo = posterUrl(member.profile_path, 'w185');
          return (
            <View key={member.id} style={styles.member}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
              ) : (
                <View
                  style={[
                    styles.photo,
                    styles.photoFallback,
                    { backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText themeColor="textSecondary">
                    {(member.name.trim()[0] ?? '?').toUpperCase()}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="small" numberOfLines={1} style={styles.name}>
                {member.name}
              </ThemedText>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.three,
    marginBottom: Spacing.four,
  },
  title: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    fontSize: 18,
  },
  row: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  member: {
    width: 84,
  },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginBottom: Spacing.one,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 12,
    lineHeight: 16,
  },
});
