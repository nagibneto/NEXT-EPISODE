import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { ContinueItem } from '@/hooks/use-home-data';
import { useTheme } from '@/hooks/use-theme';
import { localizedTitle } from '@/lib/locale';
import { posterUrl, stillUrl } from '@/lib/tmdb';

const CARD_WIDTH = 232;
const SIDE_PADDING = Spacing.three;

/**
 * Faixa "Continue assistindo" da aba Início: o próximo episódio das séries em
 * que o usuário mexeu por último, com a cena do episódio e o botão de marcar
 * como visto — o gesto mais repetido do app, a um toque da abertura.
 */
export function HomeContinueWatching({
  items,
  onMarkWatched,
}: {
  items: ContinueItem[];
  onMarkWatched: (item: ContinueItem) => Promise<void>;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  function confirmMark(item: ContinueItem) {
    const code = t('home.seasonEpisodeCompact', {
      season: String(item.next.seasonNumber).padStart(2, '0'),
      episode: String(item.next.episodeNumber).padStart(2, '0'),
    });
    const showName = localizedTitle(item.show.name, item.show.name_en, i18n.language);
    Alert.alert(
      t('home.markWatchedAlert.title'),
      `${showName} — ${code}${item.next.name ? ` (${item.next.name})` : ''}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.markWatchedAlert.confirm'),
          onPress: async () => {
            setBusyId(item.show.tmdb_id);
            try {
              await onMarkWatched(item);
            } catch {
              Alert.alert(t('home.markWatchedError'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}>
      {items.map((item) => {
        const { show, next } = item;
        const image =
          (next.stillPath ? stillUrl(next.stillPath) : null) ?? posterUrl(show.poster_path, 'w342');
        const available = next.availableCount ?? 0;
        return (
          <Pressable
            key={show.tmdb_id}
            style={[styles.card, { backgroundColor: theme.backgroundElement }]}
            onPress={() =>
              router.push({
                pathname: '/episode/[showId]/[seasonNumber]/[episodeNumber]',
                params: {
                  showId: String(show.tmdb_id),
                  seasonNumber: String(next.seasonNumber),
                  episodeNumber: String(next.episodeNumber),
                },
              })
            }>
            <View style={[styles.still, { backgroundColor: theme.backgroundSelected }]}>
              {image ? (
                <Image
                  source={{ uri: image }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
              ) : null}
              {available > 1 ? (
                <View style={styles.badge}>
                  <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.gold }]}>
                    {t('home.availableEpisodes', { count: available })}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.footer}>
              <View style={styles.text}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {localizedTitle(show.name, show.name_en, i18n.language)}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                  style={styles.episode}>
                  {t('home.seasonEpisodeCompact', {
                    season: String(next.seasonNumber).padStart(2, '0'),
                    episode: String(next.episodeNumber).padStart(2, '0'),
                  })}
                  {next.name ? `  ·  ${next.name}` : ''}
                </ThemedText>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.check,
                  { backgroundColor: pressed ? theme.accent : theme.backgroundSelected },
                ]}
                hitSlop={10}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={t('home.markWatchedAlert.title')}
                onPress={() => confirmMark(item)}>
                {busyId === show.tmdb_id ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Ionicons name="checkmark" size={20} color={theme.text} />
                )}
              </Pressable>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    // Sangra o padding lateral da Início: os cards passam por baixo das bordas.
    marginHorizontal: -SIDE_PADDING,
  },
  row: {
    paddingHorizontal: SIDE_PADDING,
    gap: Spacing.two + Spacing.one,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  still: {
    width: CARD_WIDTH,
    aspectRatio: 16 / 9,
  },
  badge: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    borderRadius: Radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.two + Spacing.one,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  text: {
    flex: 1,
  },
  episode: {
    fontSize: 12,
    lineHeight: 17,
  },
  check: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
