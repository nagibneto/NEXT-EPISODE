/**
 * Troféus públicos da PlayStation Network, via Edge Function `psn`
 * (supabase/functions/psn — API NÃO oficial, ver o cabeçalho de lá). O
 * usuário só informa o ID online; troféus privados = nada aparece.
 */

import { invokeCached } from './igdb';

export interface PsnProfile {
  accountId: string;
  onlineId: string;
  avatarUrl: string | null;
  /** false = troféus não visíveis para "Qualquer pessoa". */
  isPublic: boolean;
  level: number | null;
  platinum: number | null;
}

export interface TrophyCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

export interface PsnTrophy {
  name: string;
  description: string | null;
  icon: string | null;
  type: 'bronze' | 'silver' | 'gold' | 'platinum';
  /** ISO 8601. */
  earnedAt: string;
}

export type PsnGameStats =
  | { private: true }
  | { private: false; owned: false }
  | {
      private: false;
      owned: true;
      /** "PS5", "PS4", "PS3,PSVITA"… */
      platform: string;
      /** 0–100, calculado pela Sony (pesa troféus maiores). */
      progress: number;
      earned: TrophyCounts;
      defined: TrophyCounts;
      lastUpdated: string;
      latest: PsnTrophy[];
    };

export interface PsnRecentTitle {
  name: string;
  platform: string;
  /** Último troféu/atualização (ISO 8601). */
  lastUpdated: string;
}

export async function resolvePsnProfile(input: string): Promise<PsnProfile> {
  const { profile } = await invokeCached<{ profile: PsnProfile }>(
    'psn',
    `resolve:${input.trim().toLowerCase()}`,
    { action: 'resolve', input: input.trim() },
    0
  );
  return profile;
}

export async function getPsnGameStats(
  accountId: string,
  gameName: string,
  lang: string
): Promise<PsnGameStats> {
  const { stats } = await invokeCached<{ stats: PsnGameStats }>(
    'psn',
    `stats:${accountId}:${gameName.toLowerCase()}:${lang}`,
    { action: 'stats', accountId, gameName, lang },
    5 * 60 * 1000
  );
  return stats;
}

/** Títulos com troféu mais recentes (para a sincronização da Biblioteca). */
export async function getPsnRecentTitles(accountId: string): Promise<PsnRecentTitle[]> {
  const { titles } = await invokeCached<{ titles: PsnRecentTitle[] }>(
    'psn',
    `recent:${accountId}`,
    { action: 'recent', accountId },
    0
  );
  return titles;
}

export interface PsnHistoryTitle extends PsnRecentTitle {
  /** 0–100. */
  progress: number;
  platinum: boolean;
}

/** Todos os jogos com troféu (para importar o histórico completo). */
export async function getPsnHistory(accountId: string): Promise<PsnHistoryTitle[]> {
  const { titles } = await invokeCached<{ titles: PsnHistoryTitle[] }>(
    'psn',
    `history:${accountId}`,
    { action: 'history', accountId },
    0
  );
  return titles;
}
