import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MediaType } from '@/lib/db';

export interface MediaGridItem {
  media: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
}

type MediaFilter = MediaType | null;

/**
 * Grade de pôsteres (séries + filmes misturados) com chips de filtro
 * Séries/Filmes — usada nas telas Favoritos e Para assistir.
 */
export function MediaGrid({
  items,
  emptyTitle,
  emptyText,
}: {
  /** null = carregando. */
  items: MediaGridItem[] | null;
  emptyTitle: string;
  emptyText: string;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useState<MediaFilter>(null);

  const filtered = useMemo(() => {
    if (!items || !filter) return items ?? [];
    return items.filter((item) => item.media === filter);
  }, [items, filter]);

  if (items === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.chipsRow}>
        {(
          [
            { value: 'tv', label: 'Séries' },
            { value: 'movie', label: 'Filmes' },
          ] as const
        ).map((option) => (
          <Pressable
            key={option.value}
            style={[
              styles.chip,
              {
                backgroundColor:
                  filter === option.value ? theme.accent : theme.backgroundElement,
              },
            ]}
            onPress={() => setFilter(filter === option.value ? null : option.value)}>
            <ThemedText
              type="small"
              style={{ color: filter === option.value ? theme.accentText : theme.text }}>
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={filtered}
        // media no key: um mesmo id do TMDB pode existir como série e filme.
        keyExtractor={(item) => `${item.media}-${item.tmdb_id}`}
        numColumns={3}
        // No Android o recorte de views fora da tela faz as imagens sumirem
        // durante o scroll; a lista é curta o bastante para mantê-las vivas.
        removeClippedSubviews={false}
        contentContainerStyle={[styles.list, !filtered.length && styles.listEmpty]}
        ListEmptyComponent={
          filter && items.length > 0 ? (
            <ThemedText themeColor="textSecondary" style={styles.message}>
              Nada por aqui com esse filtro.
            </ThemedText>
          ) : (
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.message}>
                {emptyTitle}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                {emptyText}
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ShowCard
            tmdbId={item.tmdb_id}
            name={item.title}
            posterPath={item.poster_path}
            media={item.media}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 6,
  },
  list: {
    padding: Spacing.two,
  },
  // Faz o estado vazio ocupar a tela toda para o texto ficar no centro.
  listEmpty: {
    flexGrow: 1,
  },
  message: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
});
