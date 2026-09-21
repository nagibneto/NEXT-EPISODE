/**
 * Transporte entre o app e o widget no Android.
 *
 * Bem mais simples que no iOS: o widget é desenhado por uma tarefa headless
 * que roda no mesmo contexto JS do app, então os dois já compartilham o
 * AsyncStorage. Não há App Group, nem módulo nativo para escrever — só gravar
 * e pedir o redesenho.
 */

import { requestWidgetUpdate } from 'react-native-android-widget';

import { localizePosters, prunePosters } from '@/widgets/poster-cache';
import { ANDROID_WIDGET_NAME, renderNextEpisodeWidget } from '@/widgets/render';
import {
  clearAll,
  clearConsumed,
  clearPending,
  readPending,
  writePayload,
  writePending,
} from '@/widgets/storage';
import type { PendingWatchedEvent, WidgetEpisode, WidgetPayload } from './widget-data';

/** Redesenha todos os widgets que estiverem na tela inicial. */
async function refreshWidgets(): Promise<void> {
  await requestWidgetUpdate({
    widgetName: ANDROID_WIDGET_NAME,
    renderWidget: renderNextEpisodeWidget,
    // Nenhum widget adicionado: nada a fazer, e não é erro.
    widgetNotFound: () => {},
  }).catch(() => {});
}

/**
 * Troca as URLs dos cartazes por arquivos locais antes de guardar.
 *
 * A biblioteca do widget baixa toda imagem remota na hora de desenhar, sem
 * cache — e desenha duas vezes (claro e escuro). Deixando o arquivo pronto em
 * disco, o redesenho não toca na rede, e trocar de seção fica instantâneo.
 */
async function withLocalPosters(payload: WidgetPayload): Promise<WidgetPayload> {
  const urls = [...payload.watchNext, ...payload.upcoming].map((e) => e.posterUrl);
  const byUrl = await localizePosters(urls);
  const localize = (episode: WidgetEpisode): WidgetEpisode => ({
    ...episode,
    posterUrl: episode.posterUrl ? (byUrl.get(episode.posterUrl) ?? episode.posterUrl) : null,
  });

  // A limpeza usa as URLs remotas, que são a chave do nome do arquivo.
  prunePosters(urls).catch(() => {});

  return {
    ...payload,
    watchNext: payload.watchNext.map(localize),
    upcoming: payload.upcoming.map(localize),
  };
}

export async function writeWidgetPayload(payload: WidgetPayload): Promise<void> {
  await writePayload(await withLocalPosters(payload).catch(() => payload));
  // A lista de "já marcados" não é limpa aqui: publicar não significa que a
  // fila foi enviada ao Supabase. Quem limpa é clearConsumedWatched.
  await refreshWidgets();
}

export async function clearWidgetStorage(strings: Record<string, string>): Promise<void> {
  await clearAll();
  // Cartazes em disco também saem: o widget não pode continuar com as capas da
  // conta anterior depois do logout.
  await prunePosters([]);
  // Mantém os textos traduzidos para o widget avisar em português em vez de
  // ficar em branco depois do logout.
  await writePayload({
    version: 1,
    updatedAt: new Date().toISOString(),
    strings,
    upcoming: [],
    watchNext: [],
    quiz: null,
  });
  await refreshWidgets();
}

/**
 * Retira da fila as marcações feitas no widget. Esvazia na hora (em vez de
 * depois do envio) para o widget poder continuar empilhando durante a
 * sincronização; o que falhar volta pela restorePendingWatched.
 */
export async function claimPendingWatched(): Promise<PendingWatchedEvent[]> {
  const pending = await readPending();
  if (pending.length === 0) return [];
  await clearPending();
  return pending;
}

export async function restorePendingWatched(events: PendingWatchedEvent[]): Promise<void> {
  if (events.length === 0) return;
  await writePending([...events, ...(await readPending())]);
}

/**
 * Tira o visual de "marcado" das linhas. Só depois de a fila ter sido gravada
 * no Supabase — até lá o ✓ precisa continuar na tela, senão a pessoa acha que
 * o toque se perdeu.
 */
export async function clearConsumedWatched(): Promise<void> {
  await clearConsumed();
  await refreshWidgets();
}

export function describeWidgetStorage(): string {
  return 'AsyncStorage compartilhado (Android)';
}
