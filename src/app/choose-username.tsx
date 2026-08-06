import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { setUsernameAndClearFlag } from '@/lib/db';

/**
 * Tela obrigatória logo após o primeiro login social (Google/Apple/Facebook):
 * esses provedores não mandam um @usuário, só nome e foto (ver
 * handle_new_user em supabase/schema.sql), então pedimos aqui antes de
 * liberar as abas — a guarda fica em (tabs)/_layout.tsx.
 */
export default function ChooseUsernameScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Redirect href="/login" />;

  async function handleSubmit() {
    setError(null);
    if (username.trim().length < 3) {
      setError(t('login.usernameTooShort'));
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      await setUsernameAndClearFlag(user.id, username);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>
          {t('chooseUsername.title')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.title}>
          {t('chooseUsername.subtitle')}
        </ThemedText>

        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          placeholder={t('login.usernamePlaceholder')}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoFocus
          value={username}
          onChangeText={setUsername}
          onSubmitEditing={handleSubmit}
        />

        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        <Pressable
          style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
          disabled={busy}
          onPress={handleSubmit}>
          {busy ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('chooseUsername.submit')}
            </ThemedText>
          )}
        </Pressable>

        <View style={styles.signOutRow}>
          <Pressable hitSlop={8} disabled={busy} onPress={() => signOut()}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('chooseUsername.signOut')}
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: {
    textAlign: 'center',
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutRow: {
    alignItems: 'center',
  },
});
