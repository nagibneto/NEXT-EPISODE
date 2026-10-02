import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { QuickAddState } from '@/hooks/use-quick-add';
import type { DiscoverItem } from '@/lib/discover';
import { posterUrl } from '@/lib/tmdb';

const CARD_WIDTH = 116;

/** Abaixo disso a prateleira parece quebrada; melhor não mostrar. */
const MIN_ITEMS = 3;

interface PosterShelfProps {
  title: string;
  media: 'tv' | 'movie';
  /** Chamado uma vez na montagem; a tela troca a `key` para recarregar. */
  load: () => Promise<DiscoverItem[]>;
  /** Mostra o "Se curtiu X" embaixo do pôster quando a indicação tem um. */
  showReason?: boolean;
  quickAdd?: {
    stateFor: (media: 'tv' | 'movie', id: number) => QuickAddState;
    isBusy: (media: 'tv' | 'movie', id: number) => boolean;
    toggle: (media: 'tv' | 'movie', item: DiscoverItem) => void;
  };
}

/**
 * Carrossel de uma categoria da aba "Para você". Mostra o esqueleto enquanto
 * carrega e some se a categoria vier vazia ou falhar — uma prateleira a menos
 * não pode quebrar a tela.
 */
export function PosterShelf({ title, media, load, showReason = false, quickAdd }: PosterShelfProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<DiscoverItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // `load` é recriada a cada render da tela; a tela troca a `key` do
    // componente quando o conteúdo precisa mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items && items.length < MIN_ITEMS) return null;

  const decimal = i18n.language.startsWith('pt') ? ',' : '.';

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>
      {items === null ? (
        <View style={styles.row}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[styles.poster, styles.skeleton, { backgroundColor: theme.backgroundElement }]}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(item) => `${media}-${item.id}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          // Sem isso o "+" de um card não redesenha ao mudar de estado.
          extraData={quickAdd}
          renderItem={({ item }) => {
            const poster = posterUrl(item.posterPath, 'w342');
            const state = quickAdd?.stateFor(media, item.id) ?? 'none';
            const busy = quickAdd?.isBusy(media, item.id) ?? false;
            const rating =
              item.voteAverage > 0 ? item.voteAverage.toFixed(1).replace('.', decimal) : null;
            return (
              <Link
                href={
                  media === 'movie'
                    ? { pathname: '/movie/[id]', params: { id: String(item.id) } }
                    : { pathname: '/show/[id]', params: { id: String(item.id) } }
                }
                asChild>
                <Pressable style={styles.card}>
                  {poster ? (
                    <Image
                      source={{ uri: poster }}
                      style={styles.poster}
                      contentFit="cover"
                      transition={150}
                      cachePolicy="memory-disk"
                      recyclingKey={String(item.id)}
                    />
                  ) : (
                    <View style={[styles.poster, { backgroundColor: theme.backgroundElement }]} />
                  )}
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                    {item.title}
                  </ThemedText>
                  <View style={styles.metaRow}>
                    {item.year ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                        {item.year}
                      </ThemedText>
                    ) : null}
                    {rating ? (
                      <View style={styles.rating}>
                        <Ionicons name="star" size={10} color={theme.gold} />
                        <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                          {rating}
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                  {showReason && item.because ? (
                    <ThemedText
                      type="small"
                      numberOfLines={1}
                      style={[styles.reason, { color: theme.accent }]}>
                      {t('discover.because', { title: item.because })}
                    </ThemedText>
                  ) : null}
                  {quickAdd ? (
                    <Pressable
                      style={[
                        styles.quickAdd,
                        { backgroundColor: state === 'none' ? 'rgba(0,0,0,0.6)' : theme.accent },
                      ]}
                      hitSlop={8}
                      disabled={busy || state === 'done'}
                      onPress={() => quickAdd.toggle(media, item)}>
                      {busy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons
                          name={
                            state === 'none'
                              ? 'add'
                              : state === 'listed' && media === 'movie'
                                ? 'bookmark'
                                : 'checkmark'
                          }
                          size={18}
                          color="#fff"
                        />
                      )}
                    </Pressable>
                  ) : null}
                </Pressable>
              </Link>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.four,
  },
  title: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    fontSize: 18,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    width: CARD_WIDTH,
  },
  poster: {
    width: CARD_WIDTH,
    aspectRatio: 2 / 3,
    borderRadius: 12,
  },
  skeleton: {
    opacity: 0.7,
  },
  name: {
    marginTop: Spacing.one,
    fontSize: 13,
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reason: {
    fontSize: 11,
    lineHeight: 15,
  },
  quickAdd: {
    position: 'absolute',
    top: Spacing.one + 2,
    right: Spacing.one + 2,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
