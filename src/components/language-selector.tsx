import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useLanguagePreference } from '@/hooks/use-language-preference';
import { useTheme } from '@/hooks/use-theme';
import type { AppLanguage } from '@/lib/i18n';

const OPTIONS: { value: AppLanguage; flag: string; label: string }[] = [
  { value: 'pt-BR', flag: '🇧🇷', label: 'Português' },
  { value: 'en-US', flag: '🇺🇸', label: 'English' },
];

/**
 * Alternador de idioma discreto usado no perfil, no mesmo estilo do
 * ThemeSelector. O app segue o idioma do aparelho por padrão; tocar numa
 * opção fixa a escolha do usuário (e sincroniza com o Supabase para as
 * notificações push saírem no idioma certo).
 */
export function LanguageSelector() {
  const theme = useTheme();
  const { language, setPreference } = useLanguagePreference();

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      {OPTIONS.map((option) => {
        const selected = language === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.option, selected && { backgroundColor: theme.backgroundSelected }]}
            accessibilityLabel={option.label}
            onPress={() => setPreference(option.value)}>
            <ThemedText style={styles.flag}>{option.flag}</ThemedText>
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
  flag: {
    fontSize: 18,
    lineHeight: 20,
  },
});
