import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemeSelector } from '@/components/theme-selector';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const { session, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (session) return <Redirect href="/(tabs)" />;

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    if (!email.trim() || (mode !== 'forgot' && !password)) {
      setError(mode === 'forgot' ? 'Preencha o e-mail.' : 'Preencha e-mail e senha.');
      return;
    }
    if (mode === 'signup' && username.trim().length < 3) {
      setError('O nome de usuário precisa de pelo menos 3 caracteres.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await resetPassword(email.trim());
        setMode('login');
        setInfo(
          'Enviamos um link de recuperação para o seu e-mail. Abra-o no celular para escolher uma nova senha.'
        );
      } else if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, username.trim(), displayName.trim());
        // Volta para o login com o e-mail preenchido. Se o Supabase criar a
        // sessão direto (confirmação de e-mail desativada), o Redirect acima
        // leva para as abas antes de esta tela reaparecer.
        setMode('login');
        setPassword('');
        setUsername('');
        setDisplayName('');
        setShowPassword(false);
        setInfo(
          'Conta criada! Faça login para continuar. Se a confirmação por e-mail estiver ativa, verifique sua caixa de entrada antes.'
        );
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
        <View style={styles.titleRow}>
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.titleLogo}
            resizeMode="contain"
          />
          <ThemedText type="subtitle" style={styles.title}>
            Next Episode
          </ThemedText>
        </View>
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
        {mode !== 'forgot' && (
          <View style={[styles.passwordRow, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              style={[styles.input, styles.passwordInput, { color: theme.text }]}
              placeholder="Senha"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable
              onPress={() => setShowPassword((visible) => !visible)}
              hitSlop={8}
              style={styles.eyeButton}
              accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={theme.textSecondary}
              />
            </Pressable>
          </View>
        )}
        {mode === 'login' && (
          <Pressable
            hitSlop={8}
            style={styles.forgotLink}
            onPress={() => {
              setError(null);
              setInfo(null);
              setMode('forgot');
            }}>
            <ThemedText type="small" themeColor="textSecondary">
              Esqueci minha senha
            </ThemedText>
          </Pressable>
        )}
        {mode === 'forgot' && (
          <ThemedText type="small" themeColor="textSecondary">
            Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
          </ThemedText>
        )}

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
              {mode === 'login'
                ? 'Entrar'
                : mode === 'signup'
                  ? 'Criar conta'
                  : 'Enviar link de recuperação'}
            </ThemedText>
          )}
        </Pressable>

        <View style={styles.switchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {mode === 'login' ? 'Ainda não tem conta?' : mode === 'signup' ? 'Já tem conta?' : 'Lembrou a senha?'}
          </ThemedText>
          <Pressable
            onPress={() => {
              setError(null);
              setInfo(null);
              setMode(mode === 'login' ? 'signup' : 'login');
            }}>
            <ThemedText type="linkPrimary">
              {mode === 'login' ? 'Cadastre-se' : 'Faça login'}
            </ThemedText>
          </Pressable>
        </View>

        <ThemeSelector />
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  titleLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
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
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  button: {
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
  },
  forgotLink: {
    alignSelf: 'flex-end',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
