import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortWeekdayLabel } from '@/lib/locale';
import { posterUrl } from '@/lib/tmdb';
import type { ThisWeekItem } from '@/lib/this-week';
import { daysUntil } from '@/lib/upcoming-sections';

/**
 * Faixa "Próximos" (aba Início e topo da Watchlist): o que estreia nos
 * próximos 7 dias entre as séries seguidas e os filmes da lista "Para
 * assistir". Uma linha de cards deitados que rola para o lado — some quando não
 * há nada, para não tirar espaço da lista. "Ver tudo" abre a tela Próximos,
 * que não tem aba própria.
 */
export function ThisWeekStrip({
  items,
  bleed = Spacing.two,
  showHeader = true,
}: {
  items: ThisWeekItem[];
  /** A aba Início desenha o próprio título de seção e desliga este. */
  showHeader?: boolean;
  /**
   * Padding horizontal do contêiner em volta, que a faixa compensa para os
   * cards passarem por baixo das bordas da tela ao rolar.
   */
  bleed?: number;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  if (items.length === 0) return null;

  function dayLabel(date: string) {
    const days = daysUntil(date);
    if (days <= 0) return t('upcoming.today');
    if (days === 1) return t('upcoming.tomorrow');
    return `${shortWeekdayLabel(date, i18n.language)}, ${Number(date.slice(8, 10))}`;
  }

  return (
    <View style={[styles.container, { marginHorizontal: -bleed }]}>
      {showHeader ? (
        <View style={styles.header}>
          <ThemedText type="smallBold" style={styles.title}>
            {t('home.thisWeek')}
          </ThemedText>
          <Pressable style={styles.seeAll} hitSlop={10} onPress={() => router.push('/upcoming')}>
            <ThemedText type="small" style={[styles.seeAllText, { color: theme.accent }]}>
              {t('home.thisWeekSeeAll')}
            </ThemedText>
            <Ionicons name="chevron-forward" size={12} color={theme.accent} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Sem título próprio, os cards alinham com o conteúdo em volta.
        contentContainerStyle={[styles.row, !showHeader && { paddingHorizontal: bleed }]}>
        {items.map((item) => {
          const poster = posterUrl(item.posterPath, 'w185');
          return (
            <Link
              key={`${item.media}-${item.tmdbId}`}
              href={
                item.media === 'movie'
                  ? { pathname: '/movie/[id]', params: { id: String(item.tmdbId) } }
                  : { pathname: '/show/[id]', params: { id: String(item.tmdbId) } }
              }
              asChild>
              {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
              <Pressable
                style={StyleSheet.flatten([
                  styles.card,
                  { backgroundColor: theme.backgroundElement },
                ])}>
                {poster ? (
                  <Image
                    source={{ uri: poster }}
                    style={styles.poster}
                    contentFit="cover"
                    transition={150}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
                )}
                <View style={styles.cardText}>
                  <ThemedText
                    type="smallBold"
                    numberOfLines={1}
                    style={[styles.day, { color: theme.goldText }]}>
                    {dayLabel(item.date)}
                  </ThemedText>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
                    {item.title}
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    style={styles.detail}>
                    {item.detail}
                  </ThemedText>
                </View>
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.two + Spacing.one,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    paddingHorizontal: Spacing.two + Spacing.one,
    gap: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 188,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  poster: {
    width: 42,
    height: 63,
  },
  cardText: {
    flex: 1,
    paddingHorizontal: Spacing.two + Spacing.half,
    gap: 1,
  },
  day: {
    fontSize: 11,
    lineHeight: 15,
  },
  cardTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  detail: {
    fontSize: 12,
    lineHeight: 16,
  },
});
