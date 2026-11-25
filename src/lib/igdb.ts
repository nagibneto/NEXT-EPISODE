/**
 * Acesso aos dados de games (IGDB, https://www.igdb.com).
 *
 * O app nunca fala direto com a IGDB: tudo passa pela Edge Function `igdb`
 * (supabase/functions/igdb), que guarda as credenciais da Twitch e devolve
 * um formato enxuto. Aqui só ficam os tipos, as URLs das imagens e um cache
 * em memória para não repetir chamadas durante a sessão.
 */

import { supabase } from './supabase';

export interface GameSummary {
  id: number;
  name: string;
  /** image_id da capa na IGDB; monte a URL com igdbImage(). */
  coverId: string | null;
  /** Data do primeiro lançamento, em segundos desde 1970 (formato da IGDB). */
  releaseDate: number | null;
  /** Nota agregada da IGDB (crítica + usuários), de 0 a 100. */
  rating: number | null;
  ratingCount: number;
  /** Siglas das plataformas: "PS5", "Switch", "PC"… */
  platforms: string[];
}

export interface GameDetails extends GameSummary {
  summary: string | null;
  storyline: string | null;
  genres: string[];
  themes: string[];
  platformNames: string[];
  developers: string[];
  publishers: string[];
  screenshots: string[];
  artworks: string[];
  /** Vídeos do YouTube (id do vídeo). */
  videos: { id: string; name: string | null }[];
  similar: GameSummary[];
  /** Tempo para zerar, em segundos; null quando a IGDB não tem o dado. */
  timeToBeat: { hastily: number | null; normally: number | null; completely: number | null } | null;
  /** appId na Steam (para conquistas/horas); null = jogo fora da Steam. */
  steamAppId: number | null;
  url: string | null;
}

export type GameListName = 'trending' | 'upcoming' | 'recent' | 'top';

type ImageSize =
  | 'cover_small'
  | 'cover_big'
  | 'screenshot_med'
  | 'screenshot_big'
  | 'screenshot_huge'
  | '720p'
  | '1080p';

/** URL de uma imagem da IGDB. `retina` pede o dobro da resolução (sufixo _2x). */
export function igdbImage(imageId: string | null, size: ImageSize = 'cover_big', retina = false) {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/t_${size}${retina ? '_2x' : ''}/${imageId}.jpg`;
}

/** Ano de lançamento ("2023") a partir da data da IGDB. */
export function releaseYear(releaseDate: number | null) {
  return releaseDate ? String(new Date(releaseDate * 1000).getUTCFullYear()) : null;
}

/** Ainda não lançou? (data no futuro). */
export function isUpcoming(releaseDate: number | null) {
  return releaseDate !== null && releaseDate * 1000 > Date.now();
}

/** Nota da IGDB (0–100) na mesma escala de 0–10 usada nos cards de filmes e séries. */
export function ratingOutOfTen(rating: number | null) {
  return rating ? rating / 10 : 0;
}

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const CACHE_TTL = 15 * 60 * 1000;

/**
 * Chama uma Edge Function com cache em memória e repassa a mensagem de erro
 * escrita por ela. Usada aqui (igdb) e em src/lib/steam.ts / src/lib/psn.ts.
 */
export async function invokeCached<T>(
  fn: 'igdb' | 'steam' | 'psn' | 'xbox',
  key: string,
  body: Record<string, unknown>,
  ttl = CACHE_TTL
): Promise<T> {
  const cacheKey = `${fn}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const { data, error } = await supabase.functions.invoke<T>(fn, { body });
  if (error) {
    // Mesmo esquema de edgeFunctionError em db.ts: a mensagem escrita pela
    // function fica em error.context, não em error.message.
    const context = (error as { context?: Response }).context;
    let message = 'Não foi possível carregar os games.';
    if (context && typeof context.json === 'function') {
      try {
        const parsed = await context.json();
        if (parsed && typeof parsed.error === 'string') message = parsed.error;
      } catch {
        // corpo não era JSON — fica a mensagem padrão.
      }
    }
    throw new Error(message);
  }
  if (data === null) throw new Error('Resposta vazia.');
  if (ttl > 0) cache.set(cacheKey, { expiresAt: Date.now() + ttl, value: data });
  return data;
}

async function call<T>(key: string, body: Record<string, unknown>): Promise<T> {
  return invokeCached<T>('igdb', key, body);
}

export async function searchGames(query: string): Promise<GameSummary[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { games } = await call<{ games: GameSummary[] }>(`search:${trimmed.toLowerCase()}`, {
    action: 'search',
    query: trimmed,
  });
  return games;
}

export async function getGameList(list: GameListName): Promise<GameSummary[]> {
  const { games } = await call<{ games: GameSummary[] }>(`list:${list}`, { action: 'list', list });
  return games;
}

export async function getGameDetails(id: number): Promise<GameDetails> {
  const { game } = await call<{ game: GameDetails }>(`details:${id}`, { action: 'details', id });
  return game;
}

/** Jogos da IGDB que correspondem a appIds da Steam (para importar da Steam). */
export async function lookupSteamGames(
  appIds: number[]
): Promise<{ appId: number; game: GameSummary }[]> {
  if (appIds.length === 0) return [];
  const sorted = [...new Set(appIds)].sort((a, b) => a - b).slice(0, 200);
  const { matches } = await call<{ matches: { appId: number; game: GameSummary }[] }>(
    `steam:${sorted.join(',')}`,
    { action: 'steamLookup', appIds: sorted }
  );
  return matches;
}

/**
 * Jogo da IGDB de cada nome (só aceita nome igual, ignorando acento, ™ e
 * "(PS4)"). Usado na sincronização da PSN, que não tem id em comum com a IGDB.
 */
export async function matchGameNames(
  names: string[]
): Promise<{ name: string; game: GameSummary | null }[]> {
  const unique = [...new Set(names)].slice(0, 40);
  if (unique.length === 0) return [];
  const { matches } = await call<{ matches: { name: string; game: GameSummary | null }[] }>(
    `names:${unique.join('|').toLowerCase()}`,
    { action: 'matchNames', names: unique }
  );
  return matches;
}
