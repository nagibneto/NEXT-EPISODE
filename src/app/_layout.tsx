import { Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '@/hooks/use-auth';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({ Poppins_600SemiBold });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerBackTitle: 'Voltar' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
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
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}
