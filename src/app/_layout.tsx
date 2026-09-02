import { Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { StackHeader } from '@/components/app-header';
import { AuthProvider } from '@/hooks/use-auth';
import { LanguagePreferenceProvider } from '@/hooks/use-language-preference';
import { useNotificationNavigation } from '@/hooks/use-notification-navigation';
import { ThemePreferenceProvider, useThemePreference } from '@/hooks/use-theme-preference';
// Garante que o i18next esteja inicializado antes de qualquer useTranslation().
import '@/lib/i18n';

/** Separado do RootLayout porque precisa ler o contexto de preferência de tema. */
function RootNavigator() {
  const { scheme } = useThemePreference();
  const { t } = useTranslation();
  useNotificationNavigation();

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Header próprio em JS (Voltar + título + logo): no iOS 26 o header
          nativo envolve qualquer item em uma cápsula de vidro clicável, e o
          logo tem que ficar solto, como no header das abas. */}
      <Stack screenOptions={{ header: (props) => <StackHeader {...props} /> }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="choose-username" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="show/[id]/index" options={{ title: t('common.nav.show') }} />
        <Stack.Screen name="movie/[id]" options={{ title: t('common.nav.movie') }} />
        <Stack.Screen
          name="show/[id]/season/[seasonNumber]"
          options={{ title: t('common.nav.season') }}
        />
        <Stack.Screen
          name="episode/[showId]/[seasonNumber]/[episodeNumber]"
          options={({ route }) => ({
            title: t('common.nav.episode'),
            // Anterior/Próximo trocam de episódio com router.replace, que por
            // padrão sempre anima como se fosse avançar. O parâmetro
            // "direction" (só usado aqui, não pela tela) inverte o lado da
            // animação quando o usuário está voltando.
            animation:
              (route.params as { direction?: string } | undefined)?.direction === 'prev'
                ? 'slide_from_left'
                : 'slide_from_right',
          })}
        />
        <Stack.Screen name="import-tv-time" options={{ title: t('common.nav.importTvTime') }} />
        <Stack.Screen name="friends" options={{ title: t('common.nav.friends') }} />
        <Stack.Screen
          name="find-friends-contacts"
          options={{ title: t('common.nav.findFriendsContacts') }}
        />
        <Stack.Screen name="blocked-users" options={{ title: t('common.nav.blockedUsers') }} />
        <Stack.Screen name="stats" options={{ title: t('common.nav.stats') }} />
        <Stack.Screen name="quiz" options={{ title: t('quiz.navTitle') }} />
        <Stack.Screen name="user/[id]" options={{ title: t('common.nav.profile') }} />
        <Stack.Screen name="favorites" options={{ title: t('common.nav.favorites') }} />
        <Stack.Screen name="to-watch" options={{ title: t('common.nav.toWatch') }} />
        <Stack.Screen name="notifications" options={{ title: t('common.nav.notifications') }} />
        <Stack.Screen
          name="notification-settings"
          options={{ title: t('common.nav.notificationSettings') }}
        />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Poppins_600SemiBold });

  if (!fontsLoaded) return null;

  return (
    // Necessário para gestos do react-native-gesture-handler (ex.: arrastar
    // para marcar episódio como assistido na watchlist).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemePreferenceProvider>
          <LanguagePreferenceProvider>
            <RootNavigator />
          </LanguagePreferenceProvider>
        </ThemePreferenceProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
