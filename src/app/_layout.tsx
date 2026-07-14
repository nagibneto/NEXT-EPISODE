import { Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { StackHeader } from '@/components/app-header';
import { AuthProvider } from '@/hooks/use-auth';
import { ThemePreferenceProvider, useThemePreference } from '@/hooks/use-theme-preference';

/** Separado do RootLayout porque precisa ler o contexto de preferência de tema. */
function RootNavigator() {
  const { scheme } = useThemePreference();

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Header próprio em JS (Voltar + título + logo): no iOS 26 o header
          nativo envolve qualquer item em uma cápsula de vidro clicável, e o
          logo tem que ficar solto, como no header das abas. */}
      <Stack screenOptions={{ header: (props) => <StackHeader {...props} /> }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="show/[id]/index" options={{ title: 'Série' }} />
        <Stack.Screen name="movie/[id]" options={{ title: 'Filme' }} />
        <Stack.Screen name="show/[id]/season/[seasonNumber]" options={{ title: 'Temporada' }} />
        <Stack.Screen
          name="episode/[showId]/[seasonNumber]/[episodeNumber]"
          options={{ title: 'Episódio' }}
        />
        <Stack.Screen name="import-tv-time" options={{ title: 'Importar do TV Time' }} />
        <Stack.Screen name="friends" options={{ title: 'Amigos' }} />
        <Stack.Screen name="blocked-users" options={{ title: 'Usuários bloqueados' }} />
        <Stack.Screen name="stats" options={{ title: 'Estatísticas' }} />
        <Stack.Screen name="favorites" options={{ title: 'Favoritos' }} />
        <Stack.Screen name="to-watch" options={{ title: 'Para assistir' }} />
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
          <RootNavigator />
        </ThemePreferenceProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
