/**
 * Dados que alimentam os widgets de tela inicial e de bloqueio.
 *
 * O widget roda num processo separado (Swift no iOS), sem acesso ao Supabase,
 * à TMDB ou ao i18next. Então o app é quem monta tudo pronto — inclusive os
 * textos já traduzidos — e publica um JSON no armazenamento compartilhado
 * (App Group no iOS). O widget só lê e desenha.
 *
 * Quem publica: o hook useWidgetData (montado no layout das abas) ao abrir o
 * app e nas trocas de primeiro/segundo plano, mais as telas que marcam
 * episódio como assistido. Ver src/lib/widget-bridge.ts para o transporte e
 * WIDGETS.md para o desenho todo.
 */

import {
  getFollowedShows,
  getWatchedCounts,
  markEpisodeWatched,
  type FollowedShow,
} from './db';
import { i18n } from './i18n';
import { localizedTitle, shortWeekdayLabel } from './locale';
import { getQuizState } from './quiz';
import { getShowDetailsCached, posterUrl, type TmdbShowDetails } from './tmdb';
import { getNextUnwatchedEpisode } from './watch-next';
import {
  claimPendingWatched,
  clearConsumedWatched,
  clearWidgetStorage,
  describeWidgetStorage,
  restorePendingWatched,
  writeWidgetPayload,
} from './widget-bridge';

/** Quantas estreias o widget médio recebe: 4 páginas de 3 nas setas ◀ ▶. */
const UPCOMING_LIMIT = 12;

/** Quantos "assistir a seguir" o widget recebe: 3 páginas de 3 nas setas ◀ ▶. */
const WATCH_NEXT_LIMIT = 9;

/**
 * Quantas séries são sondadas para preencher essa lista. Cada sondagem custa
 * uma consulta ao Supabase e (às vezes) uma à TMDB, então paramos assim que
 * juntamos WATCH_NEXT_LIMIT episódios pendentes.
 */
const WATCH_NEXT_CANDIDATES = 15;

/** Tamanho do lote das sondagens, igual ao que a watchlist usa. */
const WATCH_NEXT_BATCH = 6;

export interface WidgetEpisode {
  showId: number;
  showName: string;
  posterUrl: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string | null;
  /** 'YYYY-MM-DD' da estreia. A TMDB não informa o horário, só o dia. */
  airDate: string | null;
}

/**
 * Marcação de "assistido" feita pelo botão do widget enquanto o app estava
 * fechado. Fica numa fila no armazenamento compartilhado até o app abrir e
 * mandar para o Supabase (ver syncWidgetActions, no fim deste arquivo).
 */
export interface PendingWatchedEvent {
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  /** ISO do momento do toque, só para depuração e ordenação. */
  at: string;
}

/** Um dia da fita da semana do quiz. */
export interface WidgetQuizDay {
  /** "Seg", "Ter"… já no idioma do app (o widget não tem i18next). */
  label: string;
  answered: boolean;
  correct: boolean;
  /** Dia que ainda não chegou. */
  future: boolean;
  /** É o dia do quiz de hoje — ganha destaque na fita. */
  today: boolean;
}

/** Situação do quiz do dia, para a seção Quiz do widget. */
export interface WidgetQuiz {
  /** Existe pergunta para hoje (a fila de perguntas pode ter acabado). */
  hasQuestion: boolean;
  /** O usuário já respondeu a de hoje. */
  answeredToday: boolean;
  /** Acertou — só faz sentido junto com answeredToday. */
  correctToday: boolean;
  /** Dias seguidos de acerto. */
  currentStreak: number;
  /** Segunda a domingo da semana atual, como no card do perfil. */
  week: WidgetQuizDay[];
}

export interface WidgetPayload {
  /** Versão do formato: o widget ignora um JSON que não saiba ler. */
  version: 1;
  /** ISO da última publicação, para o widget avisar quando estiver velho. */
  updatedAt: string;
  /** Textos já traduzidos — o widget não tem i18next. */
  strings: Record<string, string>;
  /** Próximas estreias das séries seguidas, da mais próxima para a mais distante. */
  upcoming: WidgetEpisode[];
  /** Episódios já exibidos que faltam assistir, na ordem da watchlist. */
  watchNext: WidgetEpisode[];
  /** Null quando a consulta falhou: a seção mostra o estado de indisponível. */
  quiz: WidgetQuiz | null;
}

/**
 * Textos fixos do widget, resolvidos no idioma ativo do app. Trocar de idioma
 * no perfil republica o payload, então o widget acompanha.
 */
function widgetStrings(): Record<string, string> {
  const keys = [
    'nextEpisode',
    'upcomingTitle',
    'watchNextTitle',
    'today',
    'tomorrow',
    'inDays',
    'inHours',
    'inMinutes',
    'noUpcoming',
    'noWatchNext',
    'markWatched',
    'markedWatched',
    'openApp',
    'noData',
    'updateApp',
    'watchNextShort',
    'upcomingShort',
    'quizTitle',
    'quizShort',
    'quizPending',
    'quizPendingShort',
    'quizDone',
    'quizStreakOne',
    'quizStreakOther',
    'quizNone',
    'quizAnswer',
  ];
  return Object.fromEntries(keys.map((key) => [key, i18n.t(`widget.${key}`)]));
}

function toWidgetEpisode(
  show: FollowedShow,
  details: TmdbShowDetails,
  episode: { season_number: number; episode_number: number; name: string | null; air_date: string | null }
): WidgetEpisode {
  return {
    showId: details.id,
    showName: localizedTitle(show.name, show.name_en, i18n.language),
    // w185 é o menor cartaz nítido no tamanho que o widget usa; o download é
    // feito pelo próprio widget, então quanto menor melhor.
    posterUrl: posterUrl(show.poster_path ?? details.poster_path, 'w185'),
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    episodeName: episode.name || null,
    airDate: episode.air_date,
  };
}

/**
 * A lista "assistir a seguir": para cada série já começada, o primeiro
 * episódio exibido que falta ver.
 *
 * A ordem é a mesma da watchlist — a série cuja atividade é mais recente vem
 * primeiro, contando tanto o que foi ao ar quanto o que o usuário marcou como
 * assistido. Ordenar só pela estreia do último episódio (como era antes)
 * enchia a lista de séries em lançamento, que são justamente aquelas em que a
 * pessoa está em dia, e escondia as antigas que ela está maratonando.
 */
async function findWatchNext(
  userId: string,
  entries: { show: FollowedShow; details: TmdbShowDetails }[]
): Promise<WidgetEpisode[]> {
  // Uma RPC só devolve, por série, quantos episódios o usuário já viu e
  // quando foi a última vez (ver get_watched_counts em supabase/schema.sql).
  // Se ela falhar, deixamos o erro subir: sem esses números toda série pareceria
  // "não começada" e o widget seria publicado vazio, apagando uma lista boa.
  const counts = await getWatchedCounts();
  const countById = new Map(counts.map((count) => [count.tmdb_show_id, count]));

  function activityMs(entry: { show: FollowedShow; details: TmdbShowDetails }) {
    const watchedMs = Date.parse(countById.get(entry.details.id)?.last_watched_at ?? '');
    const airedMs = Date.parse(entry.details.last_episode_to_air?.air_date ?? '');
    const best = Math.max(
      Number.isFinite(watchedMs) ? watchedMs : -Infinity,
      Number.isFinite(airedMs) ? airedMs : -Infinity
    );
    return Number.isFinite(best) ? best : Date.parse(entry.show.followed_at);
  }

  const candidates = entries
    // Série que a pessoa ainda nem começou não entra: o widget é para
    // continuar de onde parou, não para estrear algo novo.
    .filter((entry) => (countById.get(entry.details.id)?.episode_count ?? 0) > 0)
    .sort((a, b) => activityMs(b) - activityMs(a))
    .slice(0, WATCH_NEXT_CANDIDATES);

  const found: WidgetEpisode[] = [];
  for (let i = 0; i < candidates.length && found.length < WATCH_NEXT_LIMIT; i += WATCH_NEXT_BATCH) {
    const batch = candidates.slice(i, i + WATCH_NEXT_BATCH);
    const results = await Promise.all(
      batch.map((entry) => getNextUnwatchedEpisode(userId, entry.details.id).catch(() => null))
    );
    results.forEach((next, index) => {
      if (!next || found.length >= WATCH_NEXT_LIMIT) return;
      const { show, details } = batch[index];
      found.push(
        toWidgetEpisode(show, details, {
          season_number: next.seasonNumber,
          episode_number: next.episodeNumber,
          name: next.name,
          // Já exibido: não há contagem regressiva neste cartão.
          air_date: null,
        })
      );
    });
  }
  return found;
}

/** Monta o payload atual do usuário sem publicar (útil em testes e no Android). */
export async function buildWidgetPayload(userId: string): Promise<WidgetPayload> {
  const shows = await getFollowedShows(userId);
  const entries: { show: FollowedShow; details: TmdbShowDetails }[] = [];
  await Promise.all(
    shows.map(async (show) => {
      try {
        entries.push({ show, details: await getShowDetailsCached(show.tmdb_id) });
      } catch {
        // Série sem resposta da TMDB agora: fica de fora desta publicação.
      }
    })
  );

  const upcoming = entries
    .filter((entry) => entry.details.next_episode_to_air?.air_date)
    .map((entry) => toWidgetEpisode(entry.show, entry.details, entry.details.next_episode_to_air!))
    .sort((a, b) => (a.airDate! < b.airDate! ? -1 : 1))
    .slice(0, UPCOMING_LIMIT);

  // O quiz é acessório: se a consulta falhar, o resto do widget continua
  // valendo e a seção mostra que está indisponível.
  const quiz = await getQuizState(userId)
    .then<WidgetQuiz>((state) => ({
      hasQuestion: state.question !== null,
      answeredToday: state.today !== null,
      correctToday: state.today?.is_correct ?? false,
      currentStreak: state.currentStreak,
      week: state.week.map((day) => ({
        label: shortWeekdayLabel(day.date, i18n.language),
        answered: day.answered,
        correct: day.correct,
        future: day.future,
        today: day.date === state.quizDate,
      })),
    }))
    .catch(() => null);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    strings: widgetStrings(),
    upcoming,
    watchNext: await findWatchNext(userId, entries),
    quiz,
  };
}

/**
 * Recalcula e publica os dados do widget. Nunca lança: é sempre uma tarefa de
 * segundo plano de alguma tela, e falhar só deve deixar o widget com o
 * conteúdo anterior (que continua válido — as datas são absolutas).
 */
export async function publishWidgetData(userId: string) {
  try {
    const payload = await buildWidgetPayload(userId);
    await writeWidgetPayload(payload);
    if (__DEV__) {
      // Widget vazio quase sempre é payload vazio, e não falha do Swift —
      // este log separa os dois casos sem precisar de outro build.
      console.log(
        `[widget] publicado: ${payload.upcoming.length} estreias, ` +
          `${payload.watchNext.length} para assistir — ${describeWidgetStorage()}`
      );
    }
  } catch (error) {
    // Sem rede / sessão expirada: mantém o que o widget já mostra.
    if (__DEV__) console.log('[widget] falhou ao publicar:', error);
  }
}

/** Ao sair da conta: o widget não pode continuar exibindo a lista de quem saiu. */
export async function clearWidgetData() {
  try {
    await clearWidgetStorage(widgetStrings());
  } catch {
    // Melhor esforço: não trava o logout por causa do widget.
  }
}

// ---------- Agendamento ----------

/**
 * Marcar uma temporada inteira dispara uma publicação por episódio. O atraso
 * junta tudo numa só — e é curto o bastante para o widget já estar certo
 * quando o usuário voltar para a tela inicial.
 */
const REFRESH_DEBOUNCE_MS = 1500;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Republica os dados do widget daqui a pouco, juntando chamadas seguidas. */
export function scheduleWidgetRefresh(userId: string) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    publishWidgetData(userId);
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * Publica agora, cancelando o que estava agendado. Usado quando o app vai para
 * segundo plano: é exatamente quando o widget aparece, e o timer pendente
 * pode nunca disparar com o JS suspenso.
 */
export async function flushWidgetRefresh(userId: string) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  await publishWidgetData(userId);
}

// ---------- Ações feitas no widget ----------

type WatchedSyncListener = (events: PendingWatchedEvent[]) => void;

const watchedSyncListeners = new Set<WatchedSyncListener>();

/**
 * Avisa quando marcações feitas no botão do widget entram no Supabase.
 *
 * Sem isso a watchlist continuaria mostrando o episódio antigo até o usuário
 * puxar para atualizar — ele marcou na tela inicial e, ao abrir o app, nada
 * tinha mudado. Devolve a função de cancelar a inscrição.
 */
export function onWidgetWatchedSynced(listener: WatchedSyncListener): () => void {
  watchedSyncListeners.add(listener);
  return () => {
    watchedSyncListeners.delete(listener);
  };
}

/**
 * Envia ao Supabase os "assistido" marcados no botão do widget enquanto o app
 * estava fechado. Devolve true se algo foi gravado, para quem chamou saber
 * que precisa recarregar a tela.
 *
 * O que falhar volta para a fila e tenta de novo na próxima abertura — o
 * usuário não perde a marcação por estar sem rede no momento do toque.
 */
export async function syncWidgetActions(userId: string): Promise<boolean> {
  const pending = await claimPendingWatched().catch(() => []);
  if (pending.length === 0) return false;

  const failed: PendingWatchedEvent[] = [];
  const synced: PendingWatchedEvent[] = [];
  for (const event of pending) {
    try {
      await markEpisodeWatched(userId, event.showId, event.seasonNumber, event.episodeNumber, true);
      synced.push(event);
    } catch {
      failed.push(event);
    }
  }

  if (synced.length > 0) {
    for (const listener of watchedSyncListeners) {
      try {
        listener(synced);
      } catch {
        // Uma tela com problema não pode impedir as outras de saberem.
      }
    }
  }
  if (failed.length > 0) await restorePendingWatched(failed).catch(() => {});
  // Fila zerada: as linhas do widget podem sair do estado "marcado", porque
  // a próxima publicação já virá sem esses episódios.
  else await clearConsumedWatched().catch(() => {});
  return failed.length < pending.length;
}
