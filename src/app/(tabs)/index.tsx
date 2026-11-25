import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { HomeContinueWatching } from '@/components/home-continue-watching';
import { HomeHero } from '@/components/home-hero';
import { GameHomeView } from '@/components/game-home-view';
import { PosterShelf } from '@/components/poster-shelf';
import { QuizCard } from '@/components/quiz-card';
import { ThemedText } from '@/components/themed-text';
import { ThisWeekStrip } from '@/components/this-week-strip';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAppMode } from '@/hooks/use-app-mode';
import { useHomeData } from '@/hooks/use-home-data';
import { useQuickAdd } from '@/hooks/use-quick-add';
import { useTheme } from '@/hooks/use-theme';
import { trendingShelf } from '@/lib/discover';
import { formatDate } from '@/lib/locale';
import { clearListCache } from '@/lib/tmdb';

const SIDE_PADDING = Spacing.three;

/** Título de seção da Início, com o "Ver tudo" opcional à direita. */
function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText type="smallBold" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {onSeeAll ? (
        <Pressable style={styles.seeAll} hitSlop={10} onPress={onSeeAll}>
          <ThemedText type="small" style={[styles.seeAllText, { color: theme.accent }]}>
            {t('home.seeAll')}
          </ThemedText>
          <Ionicons name="chevron-forward" size={12} color={theme.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Saudação conforme a hora local: bom dia até 12h, boa tarde até 18h. */
function greetingKey() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'home.greetingMorning';
  if (hour >= 12 && hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/** Início: no modo Games mostra a home de games; senão, a de séries/filmes. */
export default function HomeScreen() {
  const { mode } = useAppMode();
  return mode === 'games' ? <GameHomeView /> : <WatchHomeScreen />;
}

/**
 * Aba Início: a vitrine do app. De cima para baixo — saudação, destaque dos
 * filmes mais aguardados, "Continue assistindo", "Próximos" (a tela completa
 * não tem aba; chega-se por aqui), quiz do dia, atalhos e o que está em alta.
 */
function WatchHomeScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const quickAdd = useQuickAdd();
  const home = useHomeData();
  const [refreshing, setRefreshing] = useState(false);
  // Trocar a chave remonta as prateleiras "em alta", que só carregam na montagem.
  const [shelfVersion, setShelfVersion] = useState(0);

  async function handleRefresh() {
    setRefreshing(true);
    clearListCache();
    setShelfVersion((version) => version + 1);
    await home.reload();
    setRefreshing(false);
  }

  const today = formatDate(new Date().toISOString(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const shortcuts: { label: string; icon: keyof typeof Ionicons.glyphMap; href: Href }[] = [
    { label: t('tabs.upcoming'), icon: 'calendar', href: '/upcoming' },
    { label: t('common.nav.toWatch'), icon: 'bookmark', href: '/to-watch' },
    { label: t('common.nav.favorites'), icon: 'star', href: '/favorites' },
    { label: t('common.nav.stats'), icon: 'stats-chart', href: '/stats' },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
      <View style={styles.greeting}>
        <ThemedText style={styles.greetingText} numberOfLines={1}>
          {t(greetingKey())}
          {home.firstName ? `, ${home.firstName}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {today.charAt(0).toUpperCase() + today.slice(1)}
        </ThemedText>
      </View>

      <HomeHero items={home.featured} quickAdd={quickAdd.enabled ? quickAdd : undefined} />

      {home.continueItems && home.continueItems.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            title={t('home.continueWatching')}
            onSeeAll={() => router.push('/watchlist')}
          />
          <HomeContinueWatching items={home.continueItems} onMarkWatched={home.markWatched} />
        </View>
      ) : null}

      {home.upcomingItems.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={t('home.thisWeek')} onSeeAll={() => router.push('/upcoming')} />
          <ThisWeekStrip items={home.upcomingItems} bleed={SIDE_PADDING} showHeader={false} />
        </View>
      ) : null}

      <View style={styles.section}>
        <QuizCard />
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('home.explore')} />
        <View style={styles.shortcuts}>
          {shortcuts.map((shortcut) => (
            <Pressable
              key={shortcut.label}
              style={({ pressed }) => [
                styles.shortcut,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
              ]}
              onPress={() => router.push(shortcut.href)}>
              <View style={[styles.shortcutIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name={shortcut.icon} size={16} color={theme.accent} />
              </View>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.shortcutLabel}>
                {shortcut.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {/* As prateleiras trazem o próprio padding lateral; compensam o da tela. */}
      <View style={styles.shelves}>
        {(['tv', 'movie'] as const).map((media) => (
          <PosterShelf
            key={`${media}-${i18n.language}-${shelfVersion}`}
            title={t(media === 'tv' ? 'home.trendingShows' : 'home.trendingMovies')}
            media={media}
            load={() => trendingShelf(media)}
            quickAdd={quickAdd.enabled ? quickAdd : undefined}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: SIDE_PADDING,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  greeting: {
    marginBottom: Spacing.three - 2,
  },
  greetingText: {
    fontFamily: 'Poppins_600SemiBold',
    // O peso vem do próprio arquivo da fonte (ver app-header.tsx).
    fontWeight: 'normal',
    fontSize: 24,
    lineHeight: 32,
  },
  section: {
    marginTop: Spacing.four,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two + 2,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
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
  shortcuts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  shortcut: {
    // Duas colunas: metade da largura menos metade do espaço entre elas.
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radius.xl,
    padding: Spacing.two + 2,
  },
  shortcutIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: {
    flex: 1,
  },
  shelves: {
    marginTop: Spacing.four,
    marginHorizontal: -SIDE_PADDING,
  },
});
