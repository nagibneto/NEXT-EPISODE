import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Logo + nome do app, usado como título da aba Watchlist. */
export function AppHeaderTitle() {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ThemedText style={[styles.name, { color: theme.text }]}>Next Episode</ThemedText>
    </View>
  );
}

/** Logo sozinho, exibido à direita do header nas telas que têm título próprio. */
export function HeaderLogo() {
  return (
    <Image
      source={require('../../assets/images/logo.png')}
      // No Android o slot headerRight encosta na borda; a margem compensa.
      style={[styles.logo, styles.logoRight]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 9,
  },
  logoRight: {
    marginRight: Spacing.three,
  },
  name: {
    fontFamily: 'Poppins_600SemiBold',
    // O peso vem do próprio arquivo da fonte; fontWeight aqui faria o iOS
    // procurar outra variante e cair no fallback do sistema.
    fontWeight: 'normal',
    fontSize: 20,
    // A Poppins tem métrica alta; sem isso o texto fica desalinhado do logo.
    lineHeight: 26,
    marginTop: 4,
  },
});
