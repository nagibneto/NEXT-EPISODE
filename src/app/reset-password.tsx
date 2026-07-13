import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
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

/**
 * Tela aberta pelo link "recuperar senha" do e-mail. O deep link traz os
 * tokens no fragmento da URL e o use-auth abre a sessão; aqui só trocamos a
 * senha do usuário já autenticado por essa sessão temporária.
 */
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, loading, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (password.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      // A sessão de recuperação já é uma sessão normal; segue direto pro app.
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text },
  ];

  // Sem sessão: ou o deep link ainda está sendo processado, ou o link expirou.
  if (!session) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.container}>
          {loading ? (
            <ActivityIndicator />
          ) : (
            <>
              <ThemedText type="subtitle" style={styles.title}>
                Link inválido ou expirado
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.title}>
                Peça um novo link em “Esqueci minha senha” na tela de login.
              </ThemedText>
              <Pressable
                style={[styles.button, { backgroundColor: theme.accent }]}
                onPress={() => router.replace('/login')}>
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  Ir para o login
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>
          Criar nova senha
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.title}>
          Escolha a nova senha da sua conta.
        </ThemedText>

        <View style={[styles.passwordRow, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            style={[styles.input, styles.passwordInput, { color: theme.text }]}
            placeholder="Nova senha"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry={!showPassword}
            autoFocus
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
        <TextInput
          style={inputStyle}
          placeholder="Confirmar nova senha"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={!showPassword}
          value={confirmation}
          onChangeText={setConfirmation}
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
              Salvar nova senha
            </ThemedText>
          )}
        </Pressable>
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
});
