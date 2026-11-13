/**
 * Última renderização da watchlist, salva no aparelho para o app abrir
 * instantâneo. Quem grava é a aba Watchlist; a aba Início lê para montar
 * "Continue assistindo" e "Próximos" antes da rede responder.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FollowedShow } from './db';
import type { NextAiring } from './this-week';
import type { NextEpisode } from './watch-next';

export interface WatchlistCache {
  shows?: FollowedShow[];
  watchedById?: Record<number, number>;
  airedById?: Record<number, number | null>;
  nextEpById?: Record<number, NextEpisode | null>;
  lastWatchedAtById?: Record<number, string | null>;
  lastAirDateById?: Record<number, string | null>;
  nextAirById?: Record<number, NextAiring | null>;
}

// A chave mantém o nome de quando a watchlist era a tela inicial ("home"):
// trocar faria todo mundo abrir o app com a lista vazia uma vez.
export const watchlistCacheKey = (userId: string) => `home-cache-v1:${userId}`;

export async function readWatchlistCache(userId: string): Promise<WatchlistCache | null> {
  try {
    const raw = await AsyncStorage.getItem(watchlistCacheKey(userId));
    return raw ? (JSON.parse(raw) as WatchlistCache) : null;
  } catch {
    return null;
  }
}
