import { FlatList, StyleSheet, View } from 'react-native';

import { GameCard } from '@/components/game-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { GameStatus } from '@/lib/db';
import { ratingOutOfTen, releaseYear, type GameSummary } from '@/lib/igdb';

const CARD_WIDTH = 116;

/** Abaixo disso a prateleira parece quebrada; melhor não mostrar. */
const MIN_ITEMS = 3;

interface GameShelfProps {
  title: string;
  /** null = carregando (mostra o esqueleto). */
  games: GameSummary[] | null;
  statusFor?: (igdbId: number) => GameStatus | null;
  /** Anula o padding da tela para o carrossel correr até a borda. */
  bleed?: number;
  /** Mínimo de itens para a prateleira aparecer (padrão 3). */
  minItems?: number;
}

/**
 * Carrossel horizontal de games, no mesmo visual das prateleiras da aba
 * "Para você". Some se a lista vier vazia ou curta demais.
 */
export function GameShelf({
  title,
  games,
  statusFor,
  bleed = 0,
  minItems = MIN_ITEMS,
}: GameShelfProps) {
  const theme = useTheme();

  if (games && games.length < minItems) return null;

  return (
    <View style={[styles.container, bleed ? { marginHorizontal: -bleed } : null]}>
      <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>
      {games === null ? (
        <View style={styles.row}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[styles.skeleton, { backgroundColor: theme.backgroundElement }]}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={games}
          keyExtractor={(item) => String(item.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          // O selo de status muda quando a coleção recarrega.
          extraData={statusFor}
          renderItem={({ item }) => (
            <GameCard
              igdbId={item.id}
              name={item.name}
              coverId={item.coverId}
              subtitle={releaseYear(item.releaseDate)}
              rating={ratingOutOfTen(item.rating)}
              status={statusFor?.(item.id) ?? null}
              width={CARD_WIDTH}
            />
          )}
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
  skeleton: {
    width: CARD_WIDTH,
    aspectRatio: 3 / 4,
    borderRadius: 12,
    opacity: 0.7,
  },
});
