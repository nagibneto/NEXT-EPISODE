/**
 * Estado dos widgets no Android.
 *
 * Diferente do iOS, aqui não existe App Group: o widget é desenhado por uma
 * tarefa headless que roda no **mesmo contexto JS do app**, então o
 * AsyncStorage já é compartilhado entre os dois. Todo o transporte cabe neste
 * arquivo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PendingWatchedEvent, WidgetPayload } from '@/lib/widget-data';

const PAYLOAD_KEY = 'widget:payload';
const PENDING_KEY = 'widget:pending';
const CONSUMED_KEY = 'widget:consumed';
const SECTION_KEY = 'widget:section';

/** As telas que as setas ◀ ▶ alternam — mesma ordem do widget do iOS. */
export const WIDGET_SECTIONS = ['watchNext', 'upcoming', 'quiz'] as const;

export type WidgetSection = (typeof WIDGET_SECTIONS)[number];

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Chave corrompida: trata como vazia em vez de derrubar o desenho.
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

// ---------- Payload ----------

export async function readPayload(): Promise<WidgetPayload | null> {
  const payload = await readJson<WidgetPayload>(PAYLOAD_KEY);
  // Formato de uma versão anterior: melhor o estado vazio do que dado errado.
  return payload?.version === 1 ? payload : null;
}

export async function writePayload(payload: WidgetPayload): Promise<void> {
  await writeJson(PAYLOAD_KEY, payload);
}

// ---------- Seção atual ----------

export async function readSection(): Promise<WidgetSection> {
  const stored = await AsyncStorage.getItem(SECTION_KEY).catch(() => null);
  return WIDGET_SECTIONS.includes(stored as WidgetSection)
    ? (stored as WidgetSection)
    : WIDGET_SECTIONS[0];
}

/** Avança/volta dando a volta: são três seções e a seta nunca fica morta. */
export async function moveSection(delta: number): Promise<void> {
  const current = WIDGET_SECTIONS.indexOf(await readSection());
  const size = WIDGET_SECTIONS.length;
  const next = ((current + delta) % size + size) % size;
  await AsyncStorage.setItem(SECTION_KEY, WIDGET_SECTIONS[next]).catch(() => {});
}

// ---------- Marcações feitas no widget ----------

export async function readPending(): Promise<PendingWatchedEvent[]> {
  return (await readJson<PendingWatchedEvent[]>(PENDING_KEY)) ?? [];
}

export async function writePending(events: PendingWatchedEvent[]): Promise<void> {
  await writeJson(PENDING_KEY, events);
}

export async function clearPending(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
}

export async function readConsumed(): Promise<string[]> {
  return (await readJson<string[]>(CONSUMED_KEY)) ?? [];
}

export async function clearConsumed(): Promise<void> {
  await AsyncStorage.removeItem(CONSUMED_KEY).catch(() => {});
}

/**
 * Enfileira a marcação e guarda o episódio como respondido, para a linha mudar
 * na hora. Quem envia ao Supabase é o app, na próxima abertura
 * (syncWidgetActions em src/lib/widget-data.ts).
 *
 * Poderíamos gravar direto daqui — a tarefa headless tem o cliente do Supabase
 * à mão — mas a sessão pode não estar restaurada quando o app está fechado, e
 * uma marcação perdida é pior do que uma marcação que demora.
 */
export async function enqueueWatched(episode: {
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<void> {
  const pending = await readPending();
  pending.push({ ...episode, at: new Date().toISOString() });
  await writePending(pending);

  const id = `${episode.showId}-${episode.seasonNumber}-${episode.episodeNumber}`;
  const consumed = await readConsumed();
  if (!consumed.includes(id)) await writeJson(CONSUMED_KEY, [...consumed, id]);
}

/** Limpa tudo: usado no logout, para o widget não expor a conta anterior. */
export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove([PAYLOAD_KEY, PENDING_KEY, CONSUMED_KEY, SECTION_KEY]).catch(
    () => {}
  );
}
