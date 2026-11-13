import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnnouncementPrompt } from '@/components/announcement-prompt';
import { AppHeaderTitle, HeaderActions } from '@/components/app-header';
import { QuizDayPrompt } from '@/components/quiz-day-prompt';
import { TutorialPrompt } from '@/components/tutorial-prompt';
import { ReviewPrompt } from '@/components/review-prompt';
import { UpdatePrompt } from '@/components/update-prompt';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWidgetData } from '@/hooks/use-widget-data';
import { useAuth } from '@/hooks/use-auth';
import { getOwnProfile } from '@/lib/db';

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  // Publica os dados dos widgets (tela inicial / bloqueio) enquanto o app
  // estiver logado. Ver src/lib/widget-data.ts.
  useWidgetData();
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
      {/* Primeiro da lista de propósito: os efeitos rodam na ordem dos irmãos, e
          o tutorial precisa pegar a vaga da fila de avisos antes dos outros. */}
      <TutorialPrompt />
      <QuizDayPrompt />
      <AnnouncementPrompt />
      {/* Os dois entram na mesma fila de avisos de abertura, mas estão
          desligados por flag (UPDATE_PROMPT_ENABLED / REVIEW_PROMPT_ENABLED).
          Ver ATUALIZACAO-E-AVALIACAO.md. */}
      <UpdatePrompt />
      <ReviewPrompt />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.accent,
          // Seis destinos na barra: ícone um pouco menor e rótulo mais firme
          // dão respiro entre as abas sem tirar nenhuma.
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
          tabBarStyle: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.backgroundSelected,
          },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            headerTitle: () => <AppHeaderTitle />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size - 2} color={color} />,
          }}
        />
        <Tabs.Screen
          name="watchlist"
          options={{
            title: t('tabs.watchlist'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.watchlist')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="tv" size={size - 2} color={color} />,
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: t('tabs.discover'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.discover')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => (
              // Desenho próprio (scripts/draw-popcorn-icon.py): o "popcorn" dos
              // pacotes de ícone é só o balde e não lê como pipoca. PNG
              // monocromático, pintado com a cor da aba como os outros ícones.
              <Image
                source={require('../../../assets/images/tabIcons/popcorn.png')}
                style={{ width: size - 2, height: size - 2 }}
                tintColor={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t('tabs.search'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.search')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size - 2} color={color} />,
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: t('tabs.feed'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.feed')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size - 2} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile'),
            headerTitle: () => <AppHeaderTitle title={t('tabs.profile')} />,
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions showAvatar={false} />,
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size - 2} color={color} />,
          }}
        />
      </Tabs>
    </>
  );
}
