/**
 * Dados públicos da Steam para o modo Games, via Edge Function `steam`
 * (supabase/functions/steam). O usuário só informa o perfil — sem login; se
 * o perfil estiver privado na Steam, nada aparece.
 */

import { invokeCached } from './igdb';

export interface SteamProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
  /** false = perfil privado ou só para amigos. */
  isPublic: boolean;
}

export interface SteamAchievement {
  name: string;
  description: string | null;
  /** URL do ícone (já completa). */
  icon: string | null;
  /** Segundos desde 1970. */
  unlockedAt: number;
}

export type SteamGameStats =
  /** Detalhes de jogos privados na Steam. */
  | { private: true }
  /** Perfil público, mas o jogo não está na conta. */
  | { private: false; owned: false }
  | {
      private: false;
      owned: true;
      playtimeMinutes: number;
      lastPlayed: number | null;
      /** null = jogo sem conquistas (ou conquistas privadas). */
      achievements: { unlocked: number; total: number; latest: SteamAchievement[] } | null;
    };

export interface SteamRecentGame {
  appId: number;
  name: string;
  playtime2Weeks: number;
  playtimeForever: number;
  /** Última vez que abriu o jogo (segundos desde 1970); null = desconhecido. */
  lastPlayed: number | null;
}

const NO_CACHE = 0;
const STATS_TTL = 5 * 60 * 1000;

export async function resolveSteamProfile(input: string): Promise<SteamProfile> {
  const { profile } = await invokeCached<{ profile: SteamProfile }>(
    'steam',
    `resolve:${input.trim().toLowerCase()}`,
    { action: 'resolve', input: input.trim() },
    NO_CACHE
  );
  return profile;
}

export async function getSteamGameStats(
  steamId: string,
  appId: number,
  lang: string
): Promise<SteamGameStats> {
  const { stats } = await invokeCached<{ stats: SteamGameStats }>(
    'steam',
    `stats:${steamId}:${appId}:${lang}`,
    { action: 'stats', steamId, appId, lang },
    STATS_TTL
  );
  return stats;
}

/** Jogos jogados nas últimas 2 semanas (para importar como "Jogando"). */
export async function getSteamRecentGames(steamId: string): Promise<SteamRecentGame[]> {
  const { games } = await invokeCached<{ games: SteamRecentGame[] }>(
    'steam',
    `recent:${steamId}`,
    { action: 'recent', steamId },
    NO_CACHE
  );
  return games;
}

/** "87 h" / "45 min" a partir de minutos. */
export function formatPlaytime(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

export interface SteamHistoryGame {
  appId: number;
  playtimeMinutes: number;
  /** Segundos desde 1970; null = a Steam não sabe. */
  lastPlayed: number | null;
}

/** Todos os jogos da conta já abertos (para importar o histórico completo). */
export async function getSteamHistory(steamId: string): Promise<SteamHistoryGame[]> {
  const { games } = await invokeCached<{ games: SteamHistoryGame[] }>(
    'steam',
    `history:${steamId}`,
    { action: 'history', steamId },
    0
  );
  return games;
}
