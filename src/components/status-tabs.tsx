import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Abas em texto com sublinhado azul na ativa (estilo da watchlist). Uma aba
 * sempre ativa. Usadas nos filtros de status da watchlist e no Filmes/Séries
 * da aba "Para você".
 */
export function StatusTabs<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // Colunas de largura igual, rótulo centralizado e a barra ocupando a coluna
  // inteira — vale para 2 abas (filmes) e 3 (séries), e para qualquer idioma:
  // não depende do tamanho do texto, que varia muito entre pt-BR e en-US.
  return (
    <View style={[styles.statusTabs, { borderBottomColor: theme.backgroundSelected }, style]}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            style={styles.statusTab}
            hitSlop={8}
            onPress={() => onChange(option.value)}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              numberOfLines={1}
              style={{ color: active ? theme.accent : theme.textSecondary }}>
              {option.label}
            </ThemedText>
            <View
              style={[
                styles.statusTabIndicator,
                { backgroundColor: active ? theme.accent : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  statusTabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusTab: {
    // Colunas de largura igual, independentemente do tamanho do rótulo.
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingTop: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  statusTabIndicator: {
    height: 2,
    borderRadius: 1,
    // Ocupa a coluna inteira; o padding do Pressable vira o respiro entre as
    // barras vizinhas.
    alignSelf: 'stretch',
    // Cobre a linha divisória da barra de abas quando a aba está ativa.
    marginBottom: -StyleSheet.hairlineWidth,
  },
});
