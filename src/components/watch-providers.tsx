import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getWatchProviders,
  providerLogoUrl,
  type TmdbWatchProviders,
} from '@/lib/tmdb';

/**
 * Card "Assista em" com os logos dos streamings onde o título está disponível
 * no Brasil. Não renderiza nada enquanto carrega ou quando o título não está
 * em nenhum streaming — é um extra, não pode quebrar a tela.
 */
export function WatchProviders({
  media,
  tmdbId,
  style,
}: {
  media: 'tv' | 'movie';
  tmdbId: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [providers, setProviders] = useState<TmdbWatchProviders | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProviders(null);
    getWatchProviders(media, tmdbId)
      .then((data) => {
        if (!cancelled) setProviders(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [media, tmdbId]);

  if (!providers || providers.flatrate.length === 0) return null;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}
      disabled={!providers.link}
      onPress={() => providers.link && Linking.openURL(providers.link)}>
      <ThemedText type="smallBold">Assista em</ThemedText>
      <View style={styles.logoRow}>
        {providers.flatrate.map((provider) => {
          const logo = providerLogoUrl(provider.logo_path);
          return logo ? (
            <Image
              key={provider.provider_id}
              source={{ uri: logo }}
              style={styles.logo}
              contentFit="cover"
              accessibilityLabel={provider.provider_name}
            />
          ) : (
            <View
              key={provider.provider_id}
              style={[styles.nameChip, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small">{provider.provider_name}</ThemedText>
            </View>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Disponibilidade no Brasil · dados JustWatch
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  logoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  nameChip: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    justifyContent: 'center',
    height: 44,
  },
});
