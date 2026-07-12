import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';

/** Logo + nome do app, usado como título da aba Watchlist. */
function AppHeaderTitle() {
  const theme = useTheme();
  return (
    <View style={headerStyles.row}>
      <Image
        source={require('../../../assets/images/logo.png')}
        style={headerStyles.logo}
        resizeMode="contain"
      />
      <ThemedText style={[headerStyles.name, { color: theme.text }]}>Next Episode</ThemedText>
    </View>
  );
}

const headerStyles = StyleSheet.create({
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

export default function TabsLayout() {
  const theme = useTheme();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Watchlist',
          headerTitle: () => <AppHeaderTitle />,
          headerTitleAlign: 'left',
          tabBarIcon: ({ color, size }) => <Ionicons name="tv" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Buscar',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: 'Próximos',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
