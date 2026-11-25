/**
 * Conquistas públicas do Xbox, via Edge Function `xbox`
 * (supabase/functions/xbox — API NÃO oficial, ver o cabeçalho de lá). O
 * usuário só informa a gamertag; histórico privado = nada aparece.
 */

import { invokeCached } from './igdb';

export interface XboxProfile {
  xuid: string;
  gamertag: string;
  avatarUrl: string | null;
  gamerscore: number;
  /** false = histórico de jogos/conquistas não visível para todos. */
  isPublic: boolean;
}

export interface XboxAchievement {
  name: string;
  description: string | null;
  icon: string | null;
  gamerscore: number;
  /** ISO 8601. */
  unlockedAt: string | null;
}

export type XboxGameStats =
  | { private: true }
  | { private: false; owned: false }
  | {
      private: false;
      owned: true;
      /** "XboxSeries", "XboxOne", "PC", "Xbox360"… */
      devices: string[];
      achievements: {
        unlocked: number;
        total: number;
        gamerscore: number;
        totalGamerscore: number;
        progress: number;
      } | null;
      /** ISO 8601. */
      lastPlayed: string | null;
      latest: XboxAchievement[];
    };

export interface XboxRecentTitle {
  name: string;
  /** ISO 8601. */
  lastPlayed: string;
}

export async function resolveXboxProfile(input: string): Promise<XboxProfile> {
  const { profile } = await invokeCached<{ profile: XboxProfile }>(
    'xbox',
    `resolve:${input.trim().toLowerCase()}`,
    { action: 'resolve', input: input.trim() },
    0
  );
  return profile;
}

export async function getXboxGameStats(
  xuid: string,
  gameName: string,
  lang: string
): Promise<XboxGameStats> {
  const { stats } = await invokeCached<{ stats: XboxGameStats }>(
    'xbox',
    `stats:${xuid}:${gameName.toLowerCase()}:${lang}`,
    { action: 'stats', xuid, gameName, lang },
    5 * 60 * 1000
  );
  return stats;
}

export async function getXboxRecentTitles(xuid: string): Promise<XboxRecentTitle[]> {
  const { titles } = await invokeCached<{ titles: XboxRecentTitle[] }>(
    'xbox',
    `recent:${xuid}`,
    { action: 'recent', xuid },
    0
  );
  return titles;
}

/** "XboxSeries" → "Xbox Series", "PC" → "PC"… para exibir. */
export function formatXboxDevice(device: string) {
  const map: Record<string, string> = {
    XboxSeries: 'Xbox Series',
    XboxOne: 'Xbox One',
    Xbox360: 'Xbox 360',
    PC: 'PC',
    Win32: 'PC',
  };
  return map[device] ?? device;
}

export interface XboxHistoryTitle {
  name: string;
  /** ISO 8601; null = o Xbox não informou. */
  lastPlayed: string | null;
  /** 100% das conquistas. */
  completed: boolean;
}

/** Todo o histórico de jogos (para importar o histórico completo). */
export async function getXboxHistory(xuid: string): Promise<XboxHistoryTitle[]> {
  const { titles } = await invokeCached<{ titles: XboxHistoryTitle[] }>(
    'xbox',
    `history:${xuid}`,
    { action: 'history', xuid },
    0
  );
  return titles;
}
