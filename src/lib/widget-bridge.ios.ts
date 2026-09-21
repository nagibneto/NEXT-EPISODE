/**
 * Transporte entre o app e os widgets no iOS: um App Group compartilhado.
 *
 * O app escreve o JSON em UserDefaults(suiteName:) e pede o recarregamento do
 * timeline; o widget (Swift, em targets/widgets) lê a mesma suíte. É o único
 * canal possível — processos diferentes não compartilham AsyncStorage.
 */

import { ExtensionStorage } from '@bacons/apple-targets';

import type { PendingWatchedEvent, WidgetPayload } from './widget-data';

/** Precisa bater com o App Group em app.json e no expo-target.config.js. */
export const WIDGET_APP_GROUP = 'group.com.nagibneto.nextepisode';

/** Chaves lidas pelo Swift em targets/widgets/SharedData.swift. */
const PAYLOAD_KEY = 'widgetPayload';
const PENDING_WATCHED_KEY = 'pendingWatched';
/** Episódios que o widget já marcou e estão esperando a sincronização. */
const CONSUMED_KEY = 'consumedWatchedIds';

const storage = new ExtensionStorage(WIDGET_APP_GROUP);

export async function writeWidgetPayload(payload: WidgetPayload): Promise<void> {
  // Guardamos uma string em vez de objeto: o Swift decodifica com JSONDecoder
  // e mantém os tipos exatos (números opcionais, null vs ausente).
  storage.set(PAYLOAD_KEY, JSON.stringify(payload));
  // A lista de "já marcados" não é limpa aqui de propósito: publicar não
  // significa que a fila foi enviada ao Supabase. Quem limpa é a sincronização
  // (clearConsumedWatched), depois de gravar de verdade.
  ExtensionStorage.reloadWidget();
}

export async function clearWidgetStorage(strings: Record<string, string>): Promise<void> {
  // Mantém os textos traduzidos para o widget conseguir avisar em português
  // em vez de ficar em branco.
  const empty: WidgetPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    strings,
    upcoming: [],
    watchNext: [],
    quiz: null,
  };
  storage.set(PAYLOAD_KEY, JSON.stringify(empty));
  storage.remove(PENDING_WATCHED_KEY);
  storage.remove(CONSUMED_KEY);
  ExtensionStorage.reloadWidget();
}

/**
 * Retira da fila as marcações feitas pelo botão do widget e devolve para o app
 * enviar ao Supabase. Esvazia na hora (em vez de depois do envio) para o
 * widget poder continuar empilhando durante a sincronização; o que falhar
 * volta pela restorePendingWatched.
 */
export async function claimPendingWatched(): Promise<PendingWatchedEvent[]> {
  const raw = storage.get(PENDING_WATCHED_KEY);
  if (!raw) return [];
  storage.remove(PENDING_WATCHED_KEY);
  return parseArray<PendingWatchedEvent>(raw);
}

/** Devolve à fila o que não foi possível enviar (sem rede, por exemplo). */
export async function restorePendingWatched(events: PendingWatchedEvent[]): Promise<void> {
  if (events.length === 0) return;
  const raw = storage.get(PENDING_WATCHED_KEY);
  const current = raw ? parseArray<PendingWatchedEvent>(raw) : [];
  storage.set(PENDING_WATCHED_KEY, JSON.stringify([...events, ...current]));
}

/**
 * Tira o visual de "marcado" das linhas do widget. Só depois de a fila ter
 * sido gravada no Supabase — até lá o ✓ precisa continuar na tela, senão a
 * pessoa acha que o toque se perdeu.
 */
export async function clearConsumedWatched(): Promise<void> {
  storage.remove(CONSUMED_KEY);
}

/**
 * Confere se a publicação realmente chegou ao App Group.
 *
 * O ExtensionStorage não avisa quando o módulo nativo não está no build: ele
 * troca tudo por funções vazias e o app segue achando que gravou. Ler de volta
 * é a única forma de saber — sem isso, um widget vazio e um módulo ausente são
 * indistinguíveis do lado do JS.
 */
export function describeWidgetStorage(): string {
  // `globalThis.expo.modules` é o registro dos expo-modules nativos. Listar o
  // que há nele separa "o pod não entrou no build" de "o registro inteiro não
  // existe" — os dois somem do mesmo jeito visto de fora.
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  if (!registry) return 'globalThis.expo.modules NÃO EXISTE';

  const names = Object.keys(registry);
  if (!names.includes('ExtensionStorage')) {
    const sample = names.slice(0, 8).join(', ');
    return `ExtensionStorage AUSENTE entre ${names.length} módulos nativos [${sample}…]`;
  }

  const echo = storage.get(PAYLOAD_KEY);
  if (!echo) return 'módulo presente, mas a leitura de volta veio vazia (App Group sem entitlement?)';
  return `ok, ${echo.length} caracteres no App Group`;
}

function parseArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // JSON corrompido: descarta em vez de tentar para sempre.
    return [];
  }
}
