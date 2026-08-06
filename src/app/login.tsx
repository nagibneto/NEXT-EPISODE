import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useThemePreference } from '@/hooks/use-theme-preference';
import { useAuth } from '@/hooks/use-auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const { scheme } = useThemePreference();
  const { t } = useTranslation();
  const { session, signIn, signUp, resetPassword, signInWithApple, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  if (session) return <Redirect href="/(tabs)" />;

  async function handleSocialSignIn(action: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    if (!email.trim() || (mode !== 'forgot' && !password)) {
      setError(mode === 'forgot' ? t('login.fillEmail') : t('login.fillEmailPassword'));
      return;
    }
    if (mode === 'signup' && username.trim().length < 3) {
      setError(t('login.usernameTooShort'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await resetPassword(email.trim());
        setMode('login');
        setInfo(t('login.resetLinkSent'));
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
        setInfo(t('login.signupSuccess'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.genericError'));
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
          {t('login.tagline')}
        </ThemedText>

        {!isSupabaseConfigured && (
          <View style={[styles.configWarning, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" themeColor="danger">
              {t('login.configWarningTitle')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('login.configWarningBody')}
            </ThemedText>
          </View>
        )}

        {mode === 'signup' && (
          <>
            <TextInput
              style={inputStyle}
              placeholder={t('login.usernamePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={inputStyle}
              placeholder={t('login.displayNamePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              maxLength={40}
              value={displayName}
              onChangeText={setDisplayName}
            />
          </>
        )}
        <TextInput
          style={inputStyle}
          placeholder={t('login.emailPlaceholder')}
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
              placeholder={t('login.passwordPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable
              onPress={() => setShowPassword((visible) => !visible)}
              hitSlop={8}
              style={styles.eyeButton}
              accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}>
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
              {t('login.forgotPassword')}
            </ThemedText>
          </Pressable>
        )}
        {mode === 'forgot' && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('login.forgotInstructions')}
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
                ? t('login.submitLogin')
                : mode === 'signup'
                  ? t('login.submitSignup')
                  : t('login.submitForgot')}
            </ThemedText>
          )}
        </Pressable>

        <View style={styles.switchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {mode === 'login'
              ? t('login.noAccount')
              : mode === 'signup'
                ? t('login.hasAccount')
                : t('login.rememberedPassword')}
          </ThemedText>
          <Pressable
            onPress={() => {
              setError(null);
              setInfo(null);
              setMode(mode === 'login' ? 'signup' : 'login');
            }}>
            <ThemedText type="linkPrimary">
              {mode === 'login' ? t('login.signupLink') : t('login.loginLink')}
            </ThemedText>
          </Pressable>
        </View>

        {mode !== 'forgot' && (
          <>
            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: theme.backgroundElement }]} />
              <ThemedText type="small" themeColor="textSecondary">
                {t('login.orDivider')}
              </ThemedText>
              <View style={[styles.dividerLine, { backgroundColor: theme.backgroundElement }]} />
            </View>

            <View style={styles.socialButtons}>
              {appleAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    scheme === 'dark'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={12}
                  style={styles.appleButton}
                  onPress={() => handleSocialSignIn(signInWithApple)}
                />
              )}
              <Pressable
                disabled={busy}
                style={[styles.button, styles.googleButton, { backgroundColor: theme.backgroundElement }]}
                onPress={() => handleSocialSignIn(signInWithGoogle)}>
                <Ionicons name="logo-google" size={20} color={theme.text} />
                <ThemedText type="smallBold">{t('login.continueWithGoogle')}</ThemedText>
              </Pressable>
              {/* TODO: habilitar quando o app do Facebook Developers estiver pronto
                  (o app nasce em modo desenvolvimento na Meta, só loga devs/testers
                  até passar por App Review — ver LOGIN-SOCIAL.md). */}
            </View>
          </>
        )}

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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  socialButtons: {
    gap: Spacing.two,
  },
  appleButton: {
    height: 48,
  },
  googleButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
