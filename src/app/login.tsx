import { Redirect } from 'expo-router';
import { useState } from 'react';
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
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const { session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (session) return <Redirect href="/(tabs)" />;

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    if (mode === 'signup' && username.trim().length < 3) {
      setError('O nome de usuário precisa de pelo menos 3 caracteres.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, username.trim(), displayName.trim());
        setInfo('Conta criada! Se a confirmação por e-mail estiver ativa, verifique sua caixa de entrada.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>
          📺 Next Episode
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.tagline}>
          Acompanhe suas séries, avalie episódios e converse com outros fãs.
        </ThemedText>

        {!isSupabaseConfigured && (
          <View style={[styles.configWarning, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" themeColor="danger">
              ⚠️ Configuração pendente
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env e
              reinicie o app (veja o README).
            </ThemedText>
          </View>
        )}

        {mode === 'signup' && (
          <>
            <TextInput
              style={inputStyle}
              placeholder="Nome de usuário (único, para busca)"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={inputStyle}
              placeholder="Apelido (como você vai aparecer)"
              placeholderTextColor={theme.textSecondary}
              maxLength={40}
              value={displayName}
              onChangeText={setDisplayName}
            />
          </>
        )}
        <TextInput
          style={inputStyle}
          placeholder="E-mail"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={inputStyle}
          placeholder="Senha"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {info && <ThemedText themeColor="textSecondary">{info}</ThemedText>}

        <Pressable
          style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
          disabled={busy}
          onPress={handleSubmit}>
          {busy ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {mode === 'login' ? 'Entrar' : 'Criar conta'}
            </ThemedText>
          )}
        </Pressable>

        <View style={styles.switchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}
          </ThemedText>
          <Pressable onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            <ThemedText type="linkPrimary">
              {mode === 'login' ? 'Cadastre-se' : 'Faça login'}
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
  tagline: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  configWarning: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
