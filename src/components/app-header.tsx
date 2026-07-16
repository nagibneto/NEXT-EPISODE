import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getProfile, profileDisplayName, type Profile } from '@/lib/db';

/** Logo + título, usado no header de todas as abas (nome muda por aba). */
export function AppHeaderTitle({ title = 'Next Episode' }: { title?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ThemedText style={[styles.name, { color: theme.text }]}>{title}</ThemedText>
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
 * Sino de notificações + avatar do perfil, exibidos no header das abas.
 * Na própria aba Perfil o avatar some — mostrar o avatar de quem já está
 * na tela do perfil seria redundante.
 */
export function HeaderActions({ showAvatar = true }: { showAvatar?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id)
      .then(setProfile)
      .catch(() => {});
  }, [user]);

  return (
    <View style={styles.actionsRow}>
      <Pressable hitSlop={8} style={styles.bellButton} onPress={() => router.push('/notifications')}>
        <Ionicons name="notifications-outline" size={22} color={theme.text} />
      </Pressable>
      {showAvatar && (
        <Pressable hitSlop={4} onPress={() => router.push('/profile')}>
          <UserAvatar
            avatarId={profile?.avatar_id ?? null}
            name={profile ? profileDisplayName(profile) : (user?.email ?? '?')}
          />
        </Pressable>
      )}
    </View>
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
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginRight: Spacing.three,
  },
  bellButton: {
    alignItems: 'center',
    justifyContent: 'center',
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
