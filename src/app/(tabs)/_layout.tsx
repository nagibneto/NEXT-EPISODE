import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeaderTitle, HeaderActions } from '@/components/app-header';
import { QuizDayPrompt } from '@/components/quiz-day-prompt';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getOwnProfile } from '@/lib/db';

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const [needsUsername, setNeedsUsername] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    getOwnProfile(userId)
      .then((profile) => setNeedsUsername(profile?.needs_username ?? false))
      .catch(() => setNeedsUsername(false))
      .finally(() => setProfileLoading(false));
  }, [session?.user?.id]);

  if (loading || (session && profileLoading)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  // Login social (Google/Apple/Facebook) não manda @usuário — o app pede um
  // antes de liberar as abas (ver src/app/choose-username.tsx).
  if (needsUsername) return <Redirect href="/choose-username" />;

  return (
    <>
      <QuizDayPrompt />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.accent,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.watchlist'),
            headerTitle: () => <AppHeaderTitle />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="tv" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t('tabs.search'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.search')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="upcoming"
          options={{
            title: t('tabs.upcoming'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.upcoming')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: t('tabs.feed'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.feed')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.profile')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions showAvatar={false} />,
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          }}
        />
      </Tabs>
    </>
  );
}
