import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { AdBanner } from '@/components/ad-banner';
import { AppHeaderTitle, HeaderLogo } from '@/components/app-header';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { usePremium } from '@/hooks/use-premium';

const crownSource = require('../../../assets/images/crown.png');

/** Ícone da aba Perfil para assinantes: o boneco de sempre com a coroa em cima. */
function PremiumProfileIcon({ color, size }: { color: string; size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Image
        source={crownSource}
        contentFit="contain"
        style={{ width: size * 0.52, height: size * 0.32 }}
      />
      <Ionicons name="person" size={size * 0.68} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const { session, loading } = useAuth();
  const { isPremium } = usePremium();

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
      // Banner de anúncio (só para não-premium) encostado em cima da tab bar.
      tabBar={(props) => (
        <>
          <AdBanner />
          <BottomTabBar {...props} />
        </>
      )}
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
          headerRight: () => <HeaderLogo />,
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: 'Próximos',
          headerRight: () => <HeaderLogo />,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          headerRight: () => <HeaderLogo />,
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          headerRight: () => <HeaderLogo />,
          tabBarIcon: ({ color, size }) =>
            isPremium ? (
              <PremiumProfileIcon color={color} size={size} />
            ) : (
              <Ionicons name="person" size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}
