/**
 * Sincronização automática das contas vinculadas (Steam, PSN e Xbox) → Biblioteca.
 *
 * Quando uma tela do modo Games ganha foco, os jogos jogados desde a última
 * sincronização entram como "Jogando". Regras (iguais para as plataformas):
 * - No máximo uma consulta a cada 30 min por plataforma; puxar para
 *   atualizar força na hora.
 * - Só entra o que foi jogado DEPOIS da última sincronização. Assim, um jogo
 *   que a pessoa tirou da Biblioteca só volta se ela jogar de novo.
 * - Primeira vez (ou "Sincronizar agora"): o que foi jogado nos últimos 14
 *   dias.
 * - Jogo que já está na Biblioteca não muda de status.
 *
 * "Jogado" na PSN = ganhou troféu (é o que a Sony deixa ver de fora); na
 * Steam e no Xbox é a data em que o jogo foi aberto. O
 * "desde quando" fica no aparelho (AsyncStorage), por usuário e plataforma.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addGamesToLibraryBulk,
  getLinkedGameAccount,
  type GamePlatform,
  type GameStatus,
} from './db';
import { getEnabledPlatforms } from './game-platforms';
import { lookupSteamGames, matchGameNames, type GameSummary } from './igdb';
import { getPsnHistory, getPsnRecentTitles } from './psn';
import { getSteamHistory, getSteamRecentGames } from './steam';
import { getXboxHistory, getXboxRecentTitles } from './xbox';

const THROTTLE_MS = 30 * 60 * 1000;
const FIRST_SYNC_WINDOW_S = 14 * 86_400;

const SYNCED_PLATFORMS: readonly GamePlatform[] = ['steam', 'psn', 'xbox'];

interface SyncState {
  /** Última consulta (ms) — para o intervalo mínimo entre consultas. */
  checkedAt: number;
  /** Jogos jogados depois disto (segundos) entram na próxima vez. */
  since: number;
}

const storageKey = (userId: string, platform: GamePlatform) => `game-sync:${platform}:${userId}`;

/** Jogos da plataforma jogados depois de `since` (segundos), já casados com a IGDB. */
async function freshGames(
  platform: GamePlatform,
  accountId: string,
  since: number
): Promise<GameSummary[]> {
  if (platform === 'steam') {
    const recent = await getSteamRecentGames(accountId);
    const fresh = recent.filter((game) => (game.lastPlayed ?? 0) > since);
    if (fresh.length === 0) return [];
    const matches = await lookupSteamGames(fresh.map((game) => game.appId));
    return matches.map((match) => match.game);
  }
  if (platform === 'psn') {
    const recent = await getPsnRecentTitles(accountId);
    const fresh = recent.filter((title) => Date.parse(title.lastUpdated) / 1000 > since);
    if (fresh.length === 0) return [];
    const matches = await matchGameNames(fresh.map((title) => title.name));
    return matches.flatMap((match) => (match.game ? [match.game] : []));
  }
  if (platform === 'xbox') {
    const recent = await getXboxRecentTitles(accountId);
    const fresh = recent.filter((title) => Date.parse(title.lastPlayed) / 1000 > since);
    if (fresh.length === 0) return [];
    const matches = await matchGameNames(fresh.map((title) => title.name));
    return matches.flatMap((match) => (match.game ? [match.game] : []));
  }
  return [];
}

async function syncPlatform(
  userId: string,
  platform: GamePlatform,
  { force, allRecent }: { force: boolean; allRecent: boolean }
): Promise<number> {
  const key = storageKey(userId, platform);
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  const state: SyncState | null = raw ? JSON.parse(raw) : null;
  if (!force && state && Date.now() - state.checkedAt < THROTTLE_MS) return 0;

  const account = await getLinkedGameAccount(userId, platform);
  if (!account) return 0;

  const startedAt = Math.floor(Date.now() / 1000);
  const since = allRecent || !state ? startedAt - FIRST_SYNC_WINDOW_S : state.since;
  const games = await freshGames(platform, account.account_id, since);
  const added = await addGamesToLibraryBulk(
    userId,
    games.map((game) => ({ igdb_id: game.id, name: game.name, cover_image_id: game.coverId })),
    'playing'
  );

  const next: SyncState = { checkedAt: Date.now(), since: startedAt };
  await AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
  return added;
}

let inFlight: Promise<number> | null = null;

/**
 * Sincroniza as contas vinculadas e devolve quantos jogos entraram.
 * - `force`: ignora o intervalo de 30 min (puxar para atualizar).
 * - `allRecent`: traz tudo dos últimos 14 dias, não só o que é novo.
 * - `platform`: só uma plataforma (botão "Sincronizar agora" de cada conta).
 * Uma plataforma fora do ar não impede a outra.
 */
export function syncLinkedAccounts(
  userId: string,
  options: { force?: boolean; allRecent?: boolean; platform?: GamePlatform } = {}
): Promise<number> {
  const { force = false, allRecent = false, platform } = options;
  // Botão manual roda na hora; o foco de várias telas compartilha uma rodada.
  if (inFlight && !platform) return inFlight;
  const run = getEnabledPlatforms()
    .then((enabled) => {
      // Plataforma desligada no interruptor remoto (game_platforms) não sincroniza.
      const platforms = (platform ? [platform] : SYNCED_PLATFORMS).filter((p) => enabled.has(p));
      return Promise.allSettled(platforms.map((p) => syncPlatform(userId, p, { force, allRecent })));
    })
    .then((results) => {
      // Botão manual: o erro precisa aparecer para a pessoa.
      if (platform && results[0]?.status === 'rejected') throw results[0].reason;
      return results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
    });
  if (platform) return run;
  inFlight = run.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Esquece o "desde quando" de uma plataforma (ao vincular/desvincular). */
export async function resetSync(userId: string, platform: GamePlatform) {
  await AsyncStorage.removeItem(storageKey(userId, platform)).catch(() => {});
}

// ---------- Importação do histórico completo ----------

/** Jogado há menos que isso = "Jogando"; mais antigo = "Joguei". */
const PLAYING_WINDOW_MS = 30 * 86_400_000;
/** Lotes por chamada às functions (limites de steamLookup / matchNames). */
const STEAM_LOOKUP_CHUNK = 200;
const NAME_MATCH_CHUNK = 40;

interface HistoryItem {
  /** appId (Steam) ou nome (PSN/Xbox) — o que casa com a IGDB. */
  key: number | string;
  /** ms; null = desconhecido. */
  lastPlayed: number | null;
  completed: boolean;
}

function statusFor(item: HistoryItem): GameStatus {
  if (item.completed) return 'completed';
  if (item.lastPlayed && Date.now() - item.lastPlayed < PLAYING_WINDOW_MS) return 'playing';
  return 'played';
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function historyItems(platform: GamePlatform, accountId: string): Promise<HistoryItem[]> {
  if (platform === 'steam') {
    return (await getSteamHistory(accountId)).map((game) => ({
      key: game.appId,
      lastPlayed: game.lastPlayed ? game.lastPlayed * 1000 : null,
      // A Steam não diz "zerado" sem 1 chamada por jogo; fica Jogando/Joguei.
      completed: false,
    }));
  }
  if (platform === 'psn') {
    return (await getPsnHistory(accountId)).map((title) => ({
      key: title.name,
      lastPlayed: Date.parse(title.lastUpdated) || null,
      completed: title.platinum || title.progress >= 100,
    }));
  }
  return (await getXboxHistory(accountId)).map((title) => ({
    key: title.name,
    lastPlayed: title.lastPlayed ? Date.parse(title.lastPlayed) : null,
    completed: title.completed,
  }));
}

/**
 * Traz para a Biblioteca TODOS os jogos da conta (a vida toda, não só os
 * últimos dias), com o status que faz sentido para cada um:
 * - 100% das conquistas / platina → Zerei
 * - jogado nos últimos 30 dias → Jogando
 * - o resto → Joguei
 * Jogos que já estão na Biblioteca não mudam. `onProgress` recebe (feitos,
 * total) enquanto casa os jogos com a IGDB, para a tela mostrar o andamento.
 */
export async function importFullHistory(
  userId: string,
  platform: GamePlatform,
  onProgress?: (done: number, total: number) => void
): Promise<{ found: number; matched: number; added: number }> {
  const account = await getLinkedGameAccount(userId, platform);
  if (!account) return { found: 0, matched: 0, added: 0 };

  const items = await historyItems(platform, account.account_id);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const matched: { game: GameSummary; status: GameStatus }[] = [];
  let done = 0;
  onProgress?.(0, items.length);

  if (platform === 'steam') {
    for (const chunk of chunks(items.map((item) => item.key as number), STEAM_LOOKUP_CHUNK)) {
      for (const { appId, game } of await lookupSteamGames(chunk)) {
        const item = byKey.get(appId);
        if (item) matched.push({ game, status: statusFor(item) });
      }
      done += chunk.length;
      onProgress?.(done, items.length);
    }
  } else {
    for (const chunk of chunks(items.map((item) => item.key as string), NAME_MATCH_CHUNK)) {
      for (const { name, game } of await matchGameNames(chunk)) {
        const item = byKey.get(name);
        if (item && game) matched.push({ game, status: statusFor(item) });
      }
      done += chunk.length;
      onProgress?.(done, items.length);
    }
  }

  // Mesma edição em PS4 e PS5 casa com o mesmo jogo da IGDB: fica o melhor
  // status (Zerei > Jogando > Joguei).
  const rank: Record<GameStatus, number> = { completed: 3, playing: 2, played: 1, want: 0, dropped: 0 };
  const best = new Map<number, { game: GameSummary; status: GameStatus }>();
  for (const entry of matched) {
    const current = best.get(entry.game.id);
    if (!current || rank[entry.status] > rank[current.status]) best.set(entry.game.id, entry);
  }

  let added = 0;
  for (const status of ['completed', 'playing', 'played'] as const) {
    const games = [...best.values()].filter((entry) => entry.status === status);
    for (const chunk of chunks(games, 500)) {
      added += await addGamesToLibraryBulk(
        userId,
        chunk.map(({ game }) => ({ igdb_id: game.id, name: game.name, cover_image_id: game.coverId })),
        status
      );
    }
  }

  // Daqui pra frente a sincronização automática só traz o que for novo.
  const next: SyncState = { checkedAt: Date.now(), since: Math.floor(Date.now() / 1000) };
  await AsyncStorage.setItem(storageKey(userId, platform), JSON.stringify(next)).catch(() => {});

  return { found: items.length, matched: best.size, added };
}
