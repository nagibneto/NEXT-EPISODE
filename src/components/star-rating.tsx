import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface StarRatingProps {
  /** Nota de 1 a 10 como fica salva no banco (0 ou null = sem nota). */
  value: number | null;
  onChange?: (rating: number) => void;
  disabled?: boolean;
}

/**
 * Converte a nota interna (1–10) para o texto na escala de estrelas (0–5),
 * ex.: 8 → "4", 7 → "3.5".
 */
export function formatStarRating(rating: number) {
  return (rating / 2).toFixed(rating % 2 === 0 ? 0 : 1);
}

/**
 * Seletor de 5 estrelas com meia estrela. Internamente a nota vai de 1 a 10
 * (escala do banco), mas o usuário só vê a escala 0–5.
 */
export function StarRating({ value, onChange, disabled }: StarRatingProps) {
  const theme = useTheme();
  const rating = value ?? 0;

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const starValue = star * 2;
        const filled = rating >= starValue;
        const half = !filled && rating >= starValue - 1;
        return (
          <Pressable
            key={star}
            disabled={disabled}
            hitSlop={4}
            onPress={() => {
              // Tocar de novo na mesma estrela alterna entre nota cheia e meia.
              const next = rating === starValue ? starValue - 1 : starValue;
              onChange?.(next);
            }}>
            <ThemedText style={[styles.star, { color: filled || half ? theme.gold : theme.backgroundSelected }]}>
              {half ? '⯨' : '★'}
            </ThemedText>
          </Pressable>
        );
      })}
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        {rating > 0 ? `${formatStarRating(rating)}/5` : 'Sem nota'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  star: {
    fontSize: 32,
    lineHeight: 38,
  },
  label: {
    marginLeft: Spacing.two,
  },
});
