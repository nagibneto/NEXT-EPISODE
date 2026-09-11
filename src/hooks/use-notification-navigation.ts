import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';

/** Decide a tela de destino a partir do "data" anexado à notificação (local ou push). */
function navigateForNotificationData(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;

  // URLs são o formato de deep link recomendado pelo expo-notifications.
  // O `type` abaixo continua sendo o fallback para notificações já agendadas
  // em versões anteriores do app.
  if (typeof data.url === 'string') {
    router.push(data.url as Href);
    return true;
  }

  if (data.type === 'friend_request' || data.type === 'friend_accepted') {
    router.push('/notifications');
    return true;
  }
  if (data.type === 'feed_like') {
    router.push({ pathname: '/notifications', params: { view: 'reacoes' } });
    return true;
  }
  if (data.type === 'quiz') {
    router.push('/quiz');
    return true;
  }
  // Notificações de episódio novo (local ou o cron notify-new-episodes) não
  // levam "type", só os IDs do episódio.
  if (data.tmdbShowId != null) {
    router.push('/upcoming');
    return true;
  }

  return false;
}

/**
 * Ao tocar numa notificação, leva para a tela correspondente: Próximos
 * Episódios para lançamentos, e a tela de Notificações para pedidos de
 * amizade, aceites e curtidas no feed.
 *
 * Cobre os dois casos do expo-notifications: app reaberto do zero pelo toque
 * (getLastNotificationResponse) e app já aberto em segundo plano
 * (addNotificationResponseReceivedListener).
 */
export function useNotificationNavigation(enabled: boolean) {
  const handledNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    // Em uma abertura fria, a sessão ainda pode estar sendo restaurada. Se a
    // tela do quiz montar antes disso, ela redireciona para login e o destino
    // do toque é perdido. Só consumimos a resposta após a sessão ficar pronta.
    if (!enabled) return;
    // expo-notifications não tem implementação no web (getLastNotificationResponse
    // e o listener lançam erro). Não há notificações push/local no navegador.
    if (Platform.OS === 'web') return;

    function handleResponse(response: Notifications.NotificationResponse) {
      // A notificação do quiz repete todo dia com o mesmo identificador fixo
      // (daily-quiz), então a data da entrega é o que separa o toque de hoje do
      // de ontem — sem ela, o app aberto há mais de um dia ignoraria o segundo toque.
      const notificationId = `${response.notification.request.identifier}:${response.notification.date}`;
      if (handledNotificationIds.current.has(notificationId)) return;

      const didNavigate = navigateForNotificationData(
        response.notification.request.content.data as Record<string, unknown>
      );
      if (didNavigate) handledNotificationIds.current.add(notificationId);
    }

    const response = Notifications.getLastNotificationResponse();
    if (response) {
      handleResponse(response);
      // Evita repetir a navegação toda vez que o app reabre sem um novo toque.
      Notifications.clearLastNotificationResponse();
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      handleResponse(nextResponse);
    });

    return () => subscription.remove();
  }, [enabled]);
}
