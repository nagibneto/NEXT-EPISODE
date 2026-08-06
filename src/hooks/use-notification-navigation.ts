import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

/** Decide a tela de destino a partir do "data" anexado à notificação (local ou push). */
function navigateForNotificationData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  if (data.type === 'friend_request' || data.type === 'friend_accepted') {
    router.push('/notifications');
    return;
  }
  if (data.type === 'feed_like') {
    router.push({ pathname: '/notifications', params: { view: 'reacoes' } });
    return;
  }
  // Notificações de episódio novo (local ou o cron notify-new-episodes) não
  // levam "type", só os IDs do episódio.
  if (data.tmdbShowId != null) {
    router.push('/upcoming');
  }
}

/**
 * Ao tocar numa notificação, leva para a tela correspondente: Próximos
 * Episódios para lançamentos, e a tela de Notificações para pedidos de
 * amizade, aceites e curtidas no feed.
 *
 * Cobre os dois casos do expo-notifications: app reaberto do zero pelo toque
 * (getLastNotificationResponseAsync) e app já aberto em segundo plano
 * (addNotificationResponseReceivedListener).
 */
export function useNotificationNavigation() {
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      navigateForNotificationData(
        response.notification.request.content.data as Record<string, unknown>
      );
      // Evita repetir a navegação toda vez que o app reabre sem um novo toque.
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateForNotificationData(
        response.notification.request.content.data as Record<string, unknown>
      );
    });
    return () => subscription.remove();
  }, []);
}
