import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useThemePreference } from '@/hooks/use-theme-preference';

const OPTIONS = [
  { value: 'light', label: 'Tema claro', icon: 'sunny-outline' },
  { value: 'dark', label: 'Tema escuro', icon: 'moon-outline' },
] as const;

/**
 * Alternador claro/escuro discreto usado no login e no perfil. O app segue o
 * tema do sistema por padrão; a opção marcada reflete o tema efetivo e tocar
 * na outra fixa a escolha do usuário.
 */
export function ThemeSelector() {
  const theme = useTheme();
  const { scheme, setPreference } = useThemePreference();

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      {OPTIONS.map((option) => {
        const selected = scheme === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.option, selected && { backgroundColor: theme.backgroundSelected }]}
            accessibilityLabel={option.label}
            onPress={() => setPreference(option.value)}>
            <Ionicons
              name={option.icon}
              size={16}
              color={selected ? theme.accent : theme.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignSelf: 'center',
    borderRadius: 999,
    padding: 2,
  },
  option: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
