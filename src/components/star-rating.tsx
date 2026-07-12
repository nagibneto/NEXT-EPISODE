import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface StarRatingProps {
  /** Nota de 1 a 10 (0 ou null = sem nota). */
  value: number | null;
  onChange?: (rating: number) => void;
  disabled?: boolean;
}

/** Seletor de nota de 1 a 10 exibido como 5 estrelas (cada estrela vale 2 pontos). */
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
        {rating > 0 ? `${rating}/10` : 'Sem nota'}
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
