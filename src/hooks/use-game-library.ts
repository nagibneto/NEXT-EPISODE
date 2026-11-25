import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getGameLibrary, type GameLibraryEntry, type GameStatus } from '@/lib/db';
import type { GameSummary } from '@/lib/igdb';
import { syncLinkedAccounts } from '@/lib/game-sync';

/**
 * Coleção de games do usuário, recarregada sempre que a tela volta ao foco
 * (o status pode ter mudado na tela do jogo). Também puxa das contas vinculadas (Steam/PSN)
 * o que foi jogado desde a última vez (ver src/lib/game-sync.ts): primeiro
 * mostra a coleção, depois sincroniza em segundo plano e recarrega se entrou
 * algo. `reload(true)` (puxar para atualizar) força a sincronização.
 */
export function useGameLibrary() {
  const { user } = useAuth();
  // null = carregando.
  const [library, setLibrary] = useState<GameLibraryEntry[] | null>(null);

  const reload = useCallback(
    async (forceSync = false) => {
      if (!user) return;
      const fetchLibrary = async () => {
        try {
          setLibrary(await getGameLibrary(user.id));
        } catch {
          setLibrary((prev) => prev ?? []);
        }
      };
      await fetchLibrary();
      try {
        const sync = syncLinkedAccounts(user.id, { force: forceSync });
        // Puxar para atualizar espera a Steam; no foco, roda por trás.
        if (forceSync) {
          if ((await sync) > 0) await fetchLibrary();
        } else {
          sync
            .then((added) => {
              if (added > 0) return fetchLibrary();
            })
            .catch(() => {});
        }
      } catch {
        // Plataforma fora do ar não atrapalha a Biblioteca.
      }
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const statusById = useMemo(
    () => new Map((library ?? []).map((entry) => [entry.igdb_id, entry.status])),
    [library]
  );
  const statusFor = useCallback(
    (igdbId: number): GameStatus | null => statusById.get(igdbId) ?? null,
    [statusById]
  );

  return { library, reload, statusFor };
}

/** Item da coleção no formato das prateleiras (sem ano/nota, que não guardamos). */
export function libraryEntryToSummary(entry: GameLibraryEntry): GameSummary {
  return {
    id: entry.igdb_id,
    name: entry.name,
    coverId: entry.cover_image_id,
    releaseDate: null,
    rating: null,
    ratingCount: 0,
    platforms: [],
  };
}
