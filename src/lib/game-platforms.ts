/**
 * Interruptor remoto das integrações de games (tabela game_platforms, ver
 * supabase/queries/game-platforms-setup.sql). Desligar uma plataforma no
 * banco tira ela do app na hora — card em Contas de games, card na tela do
 * jogo e sincronização — sem versão nova. Serve para PSN e Xbox, que usam
 * APIs não oficiais e podem precisar sair do ar de repente.
 *
 * Na dúvida (tabela ainda não criada, rede fora), tudo fica LIGADO: o
 * interruptor existe para desligar de propósito, não para esconder por erro.
 */

import { useEffect, useState } from 'react';

import type { GamePlatform } from './db';
import { supabase } from './supabase';

export const ALL_GAME_PLATFORMS: readonly GamePlatform[] = ['steam', 'psn', 'xbox'];

const CACHE_TTL = 5 * 60 * 1000;
let cache: { at: number; value: Set<GamePlatform> } | null = null;

export async function getEnabledPlatforms(): Promise<Set<GamePlatform>> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.value;
  const enabled = new Set<GamePlatform>(ALL_GAME_PLATFORMS);
  try {
    const { data, error } = await supabase.from('game_platforms').select('platform, enabled');
    if (!error) {
      for (const row of (data ?? []) as { platform: GamePlatform; enabled: boolean }[]) {
        if (!row.enabled) enabled.delete(row.platform);
      }
    }
  } catch {
    // fica tudo ligado
  }
  cache = { at: Date.now(), value: enabled };
  return enabled;
}

/** null enquanto carrega. */
export function useEnabledPlatforms(): Set<GamePlatform> | null {
  const [enabled, setEnabled] = useState<Set<GamePlatform> | null>(cache?.value ?? null);
  useEffect(() => {
    let cancelled = false;
    getEnabledPlatforms().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
