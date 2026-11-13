/**
 * Notificações locais de lançamento de episódios e de filmes.
 *
 * Estratégia v1: sempre que o app abre (ou o usuário segue/deixa de seguir uma
 * série), buscamos na TMDB o próximo episódio de cada série seguida e agendamos
 * uma notificação local para as 9h do dia de lançamento. Não exige servidor.
 * Os filmes da lista "Para assistir" que ainda vão estrear entram no mesmo
 * agendamento — é o "Me avise" da aba Em breve.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  deletePushToken,
  getFollowedShows,
  getNotificationPreferences,
  getWatchlistMovies,
  savePushToken,
} from './db';
import { i18n } from './i18n';
import { localizedTitle } from './locale';
import { getMovieReleaseDates } from './movie-releases';
import { getQuizState, QUIZ_RESET_HOUR } from './quiz';
import { getShowDetails } from './tmdb';

/**
 * Teto de avisos de estreia de filme agendados de uma vez. O iOS guarda no
 * máximo 64 notificações locais por app, e os episódios dividem essa cota.
 */
const MAX_MOVIE_RELEASE_NOTIFICATIONS = 20;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('episodios', {
      name: i18n.t('pushNotifications.channelName'),
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('quiz', {
      name: i18n.t('pushNotifications.quizChannelName'),
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('filmes', {
      name: i18n.t('pushNotifications.movieChannelName'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const request = await Notifications.requestPermissionsAsync();
  return request.granted;
}

// ---------- Quiz diário (notificação local) ----------

/** Identificador fixo: reagendar cancela e recria só esta, sem tocar nas de episódio. */
const QUIZ_NOTIFICATION_ID = 'daily-quiz';

/**
 * Horário local em que a notificação do quiz é entregue todo dia. É a mesma
 * hora em que o quiz vira (QUIZ_RESET_HOUR): a notificação chega exatamente
 * quando há uma pergunta nova para responder.
 */
export const QUIZ_NOTIFICATION_HOUR = QUIZ_RESET_HOUR;
export const QUIZ_NOTIFICATION_MINUTE = 0;

/**
 * (Re)agenda a notificação diária do quiz para as 20h locais. É idempotente:
 * pode ser chamada a cada abertura do app. Fica separada de
 * syncEpisodeNotifications porque aquela cancela todas as agendadas.
 *
 * O texto muda entre "inicie" e "mantenha sua escalada" conforme o usuário já
 * tenha respondido algum quiz antes — mesmo critério do QuizDayPrompt, mas
 * aqui reavaliado a cada reagendamento (a notificação repete todo dia com o
 * texto fixado na última vez que foi agendada).
 *
 * Respeita a preferência `daily_quiz` (Perfil → Notificações): desligada,
 * cancela a notificação em vez de reagendar.
 */
export async function scheduleDailyQuizNotification(userId: string) {
  if (Platform.OS === 'web') return;
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const prefs = await getNotificationPreferences(userId).catch(() => null);
  if (prefs && !prefs.daily_quiz) {
    await Notifications.cancelScheduledNotificationAsync(QUIZ_NOTIFICATION_ID).catch(() => {});
    return;
  }

  const hasAnsweredBefore = await getQuizState(userId)
    .then((state) => state.totalAnswered > 0)
    // Sem rede: mantém o texto "padrão" (mantenha), que é o que já existia.
    .catch(() => true);

  await Notifications.cancelScheduledNotificationAsync(QUIZ_NOTIFICATION_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: QUIZ_NOTIFICATION_ID,
    content: {
      title: i18n.t('pushNotifications.quizTitle'),
      body: i18n.t(
        hasAnsweredBefore ? 'pushNotifications.quizBodyContinue' : 'pushNotifications.quizBodyStart'
      ),
      // URL permite que o Expo Router abra a tela certa até quando o app é
      // iniciado pelo toque na notificação. `type` mantém compatibilidade com
      // notificações agendadas por versões anteriores do app.
      data: { type: 'quiz', url: '/quiz' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: QUIZ_NOTIFICATION_HOUR,
      minute: QUIZ_NOTIFICATION_MINUTE,
      channelId: Platform.OS === 'android' ? 'quiz' : undefined,
    },
  });
}

// ---------- Push remoto (Expo Push + Edge Function no Supabase) ----------

let lastRegisteredToken: string | null = null;

/**
 * Obtém o Expo Push Token e salva no Supabase para a Edge Function
 * notify-new-episodes enviar notificações mesmo com o app fechado.
 *
 * Requer development build no Android (Expo Go não suporta push remoto
 * desde a SDK 53) e um projectId do EAS configurado em app.json.
 */
export async function registerPushToken(userId: string) {
  if (Platform.OS === 'web') return;
  if (lastRegisteredToken) return; // já registrado nesta sessão

  const granted = await requestNotificationPermission();
  if (!granted) return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return; // sem EAS configurado, só as notificações locais funcionam

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await savePushToken(userId, token, Platform.OS === 'ios' ? 'ios' : 'android');
    lastRegisteredToken = token;
  } catch {
    // Sem rede ou em Expo Go (Android): segue só com notificações locais.
  }
}

/** Remove o token deste aparelho ao sair da conta, para não notificar o usuário errado. */
export async function unregisterPushToken(userId: string) {
  if (!lastRegisteredToken) return;
  try {
    await deletePushToken(userId, lastRegisteredToken);
  } catch {
    // Falha aqui não deve impedir o logout.
  }
  lastRegisteredToken = null;
}

/**
 * Agenda o aviso de estreia (9h do dia) de cada filme da lista "Para assistir"
 * que ainda não estreou. Chamada só por syncEpisodeNotifications, que já
 * cancelou as notificações anteriores.
 */
async function scheduleMovieReleaseNotifications(userId: string, now: Date) {
  const movies = await getWatchlistMovies(userId);
  if (movies.length === 0) return;
  const dates = await getMovieReleaseDates(movies.map((movie) => movie.tmdb_id));

  const upcoming = movies
    .map((movie) => ({ movie, fireDate: new Date(`${dates[movie.tmdb_id] ?? ''}T09:00:00`) }))
    // Sem data conhecida a `Date` é inválida e a comparação dá falso.
    .filter(({ fireDate }) => fireDate > now)
    .sort((a, b) => a.fireDate.getTime() - b.fireDate.getTime())
    .slice(0, MAX_MOVIE_RELEASE_NOTIFICATIONS);

  for (const { movie, fireDate } of upcoming) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: i18n.t('pushNotifications.movieReleaseTitle', {
            title: localizedTitle(movie.title, movie.title_en, i18n.language),
          }),
          body: i18n.t('pushNotifications.movieReleaseBody'),
          data: { url: `/movie/${movie.tmdb_id}` },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
          channelId: Platform.OS === 'android' ? 'filmes' : undefined,
        },
      });
    } catch {
      // Falha em um filme não deve impedir os demais.
    }
  }
}

/**
 * Reagenda todas as notificações de próximos episódios das séries seguidas e
 * de estreia dos filmes da lista "Para assistir". Cancela as anteriores para
 * não duplicar quando as datas mudam na TMDB.
 */
export async function syncEpisodeNotifications(userId: string) {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const shows = await getFollowedShows(userId);
  const now = new Date();

  for (const show of shows) {
    try {
      const details = await getShowDetails(show.tmdb_id);
      const next = details.next_episode_to_air;
      if (!next?.air_date) continue;

      // Notifica às 9h (horário local) do dia do lançamento.
      const fireDate = new Date(`${next.air_date}T09:00:00`);
      if (fireDate <= now) continue;

      const code = `S${next.season_number.toString().padStart(2, '0')}E${next.episode_number
        .toString()
        .padStart(2, '0')}`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: i18n.t('pushNotifications.newEpisodeTitle', { showName: details.name }),
          body: i18n.t('pushNotifications.newEpisodeBody', { code, episodeName: next.name }),
          data: {
            tmdbShowId: show.tmdb_id,
            seasonNumber: next.season_number,
            episodeNumber: next.episode_number,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
          channelId: Platform.OS === 'android' ? 'episodios' : undefined,
        },
      });
    } catch {
      // Falha em uma série não deve impedir as demais.
    }
  }

  await scheduleMovieReleaseNotifications(userId, now).catch(() => {});

  // cancelAllScheduledNotificationsAsync acima apagou a do quiz também —
  // reagenda para ela não sumir quando o usuário segue/deixa de seguir séries.
  await scheduleDailyQuizNotification(userId);
}
