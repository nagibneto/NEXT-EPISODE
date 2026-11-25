import { useCallback, useEffect, useState } from 'react';

import { getGameList, type GameListName, type GameSummary } from '@/lib/igdb';

/**
 * Carrega listas da IGDB (Em alta, Mais aguardados…) para as prateleiras.
 * Cada lista falha sozinha (vira vazia e a prateleira some); `failed` só fica
 * true quando todas falharam — aí a tela mostra o "Tentar novamente".
 */
export function useGameLists(names: readonly GameListName[]) {
  const [lists, setLists] = useState<Partial<Record<GameListName, GameSummary[]>>>({});
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const key = names.join(',');

  useEffect(() => {
    let cancelled = false;
    const wanted = key.split(',') as GameListName[];
    setFailed(false);
    Promise.allSettled(wanted.map((name) => getGameList(name))).then((settled) => {
      if (cancelled) return;
      const next: Partial<Record<GameListName, GameSummary[]>> = {};
      settled.forEach((result, index) => {
        next[wanted[index]] = result.status === 'fulfilled' ? result.value : [];
      });
      setLists(next);
      setFailed(settled.every((result) => result.status === 'rejected'));
    });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { lists, failed, reload };
}
