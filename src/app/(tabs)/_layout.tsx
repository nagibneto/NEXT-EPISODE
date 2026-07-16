import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { AppHeaderTitle, HeaderActions } from '@/components/app-header';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';

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
          headerRight: () => <HeaderActions />,
          tabBarIcon: ({ color, size }) => <Ionicons name="tv" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Buscar',
          headerTitle: () => <AppHeaderTitle title="Buscar" />,
          headerTitleAlign: 'left',
          headerRight: () => <HeaderActions />,
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: 'Próximos',
          headerTitle: () => <AppHeaderTitle title="Próximos" />,
          headerTitleAlign: 'left',
          headerRight: () => <HeaderActions />,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          headerTitle: () => <AppHeaderTitle title="Feed" />,
          headerTitleAlign: 'left',
          headerRight: () => <HeaderActions />,
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          headerTitle: () => <AppHeaderTitle title="Perfil" />,
          headerTitleAlign: 'left',
          headerRight: () => <HeaderActions showAvatar={false} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
