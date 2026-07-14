import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/**
 * Header em JS das telas empilhadas (Voltar + título + logo). Substitui o
 * header nativo porque no iOS 26 qualquer item colocado nele vira uma cápsula
 * de vidro clicável — e o logo tem que ficar solto, como no header das abas.
 */
export function StackHeader({ navigation, options, route, back }: NativeStackHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const title = options.title ?? route.name;

  return (
    <View style={{ backgroundColor: theme.background, paddingTop: insets.top }}>
      <View style={styles.stackHeaderRow}>
        {back ? (
          <Pressable hitSlop={8} onPress={navigation.goBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={theme.accent} />
            <ThemedText style={[styles.backLabel, { color: theme.accent }]}>Voltar</ThemedText>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.stackTitle}>
          {title}
        </ThemedText>
        <View style={styles.stackHeaderRight}>
          <HeaderLogo />
        </View>
      </View>
    </View>
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
  stackHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingLeft: Spacing.two,
  },
  // Laterais com largura fixa e igual para o título ficar centralizado de
  // verdade (o logo à direita ocupa menos espaço que o "Voltar").
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 96,
  },
  backLabel: {
    fontSize: 16,
  },
  stackTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
  },
  stackHeaderRight: {
    width: 96,
    alignItems: 'flex-end',
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
