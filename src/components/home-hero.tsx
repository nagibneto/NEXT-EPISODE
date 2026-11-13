import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { QuickAddState } from '@/hooks/use-quick-add';
import { useTheme } from '@/hooks/use-theme';
import type { FeaturedMovie } from '@/lib/home-featured';
import { formatDate } from '@/lib/locale';
import { backdropUrl } from '@/lib/tmdb';
import { daysUntil, relativeLabel } from '@/lib/upcoming-sections';

const CARD_GAP = Spacing.two + Spacing.one;
const SIDE_PADDING = Spacing.three;
/** Proporção do card: um pouco mais alto que 16:9, para caber título e botões. */
const CARD_RATIO = 0.62;

interface HomeHeroProps {
  /** null = carregando (mostra o esqueleto no tamanho final). */
  items: FeaturedMovie[] | null;
  quickAdd?: {
    stateFor: (media: 'tv' | 'movie', id: number) => QuickAddState;
    isBusy: (media: 'tv' | 'movie', id: number) => boolean;
    toggle: (media: 'tv' | 'movie', item: { id: number; posterPath: string | null }) => void;
  };
}

/**
 * Destaque do topo da aba Início: carrossel paginado dos filmes mais
 * aguardados, com a arte do filme em tela cheia, data de estreia, "Me avise"
 * e trailer. O texto é sempre branco sobre um degradê escuro — a arte manda
 * na cor, não o tema do app.
 */
export function HomeHero({ items, quickAdd }: HomeHeroProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  const cardWidth = Math.min(windowWidth, MaxContentWidth) - SIDE_PADDING * 2;
  const cardHeight = Math.round(cardWidth * CARD_RATIO);
  const snapInterval = cardWidth + CARD_GAP;

  if (items === null) {
    return (
      <View style={styles.container}>
        <View
          style={[
            styles.card,
            styles.skeleton,
            { width: cardWidth, height: cardHeight, backgroundColor: theme.backgroundElement },
          ]}
        />
        <View style={styles.dots} />
      </View>
    );
  }
  if (items.length === 0) return null;

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
    setActiveIndex(Math.max(0, Math.min(index, items!.length - 1)));
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={styles.row}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        renderItem={({ item }) => {
          const days = item.date ? daysUntil(item.date) : null;
          const state = quickAdd?.stateFor('movie', item.id) ?? 'none';
          const listed = state === 'listed';
          return (
            <Pressable
              style={[
                styles.card,
                { width: cardWidth, height: cardHeight, backgroundColor: theme.backgroundElement },
              ]}
              onPress={() =>
                router.push({ pathname: '/movie/[id]', params: { id: String(item.id) } })
              }>
              <Image
                source={{ uri: backdropUrl(item.backdropPath, 'w1280') ?? undefined }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
              <Image
                source={require('../../assets/images/hero-gradient.png')}
                style={styles.gradient}
                contentFit="fill"
              />
              <View style={styles.content}>
                {days !== null ? (
                  <View style={styles.tagRow}>
                    <Ionicons name="calendar" size={12} color={theme.gold} />
                    <ThemedText type="smallBold" style={[styles.tag, { color: theme.gold }]}>
                      {days > 0
                        ? t('home.featuredPremiere', {
                            date: formatDate(`${item.date}T00:00:00`, {
                              day: 'numeric',
                              month: 'short',
                            }),
                          })
                        : t('home.featuredInTheaters')}
                    </ThemedText>
                    {days > 0 ? (
                      <ThemedText type="small" style={styles.tagRelative}>
                        {`·  ${relativeLabel(days, t)}`}
                      </ThemedText>
                    ) : null}
                  </View>
                ) : null}
                <ThemedText numberOfLines={2} style={styles.title}>
                  {item.title}
                </ThemedText>
                <View style={styles.actions}>
                  {/* Filme já assistido não precisa de aviso. */}
                  {quickAdd && state !== 'done' && (days === null || days > 0) ? (
                    <Pressable
                      style={[
                        styles.button,
                        { backgroundColor: listed ? theme.accent : '#ffffff' },
                      ]}
                      hitSlop={8}
                      disabled={quickAdd.isBusy('movie', item.id)}
                      onPress={() =>
                        quickAdd.toggle('movie', { id: item.id, posterPath: item.posterPath })
                      }>
                      <Ionicons
                        name={listed ? 'notifications' : 'notifications-outline'}
                        size={15}
                        color={listed ? theme.accentText : '#000000'}
                      />
                      <ThemedText
                        type="smallBold"
                        style={[styles.buttonLabel, { color: listed ? theme.accentText : '#000000' }]}>
                        {listed ? t('upcoming.notifyOn') : t('upcoming.notifyMe')}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {item.trailerKey ? (
                    <Pressable
                      style={[styles.button, styles.buttonGlass]}
                      hitSlop={8}
                      onPress={() =>
                        Linking.openURL(`https://www.youtube.com/watch?v=${item.trailerKey}`).catch(
                          () => {}
                        )
                      }>
                      <Ionicons name="play" size={14} color="#ffffff" />
                      <ThemedText type="smallBold" style={[styles.buttonLabel, styles.onArt]}>
                        {t('home.featuredTrailer')}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <View style={styles.dots}>
        {items.length > 1
          ? items.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.dot,
                  index === activeIndex
                    ? [styles.dotActive, { backgroundColor: theme.accent }]
                    : { backgroundColor: theme.backgroundSelected },
                ]}
              />
            ))
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // O conteúdo da Início tem padding lateral; o carrossel sangra até as
    // bordas para o próximo card aparecer "espiando" na lateral.
    marginHorizontal: -SIDE_PADDING,
  },
  row: {
    paddingHorizontal: SIDE_PADDING,
    gap: CARD_GAP,
  },
  card: {
    borderRadius: Radius.xl + 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  skeleton: {
    marginHorizontal: SIDE_PADDING,
    opacity: 0.7,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '85%',
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 1,
  },
  tag: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tagRelative: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.85)',
  },
  title: {
    fontFamily: 'Poppins_600SemiBold',
    // O peso vem do próprio arquivo da fonte (ver app-header.tsx).
    fontWeight: 'normal',
    fontSize: 22,
    lineHeight: 28,
    color: '#ffffff',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one + 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 7,
  },
  buttonGlass: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  buttonLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  onArt: {
    color: '#ffffff',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    height: 6,
    marginTop: Spacing.two + 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 18,
  },
});
