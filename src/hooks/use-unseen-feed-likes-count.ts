import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getFeedLikesCountSince } from '@/lib/db';

const seenKey = (userId: string) => `feed-likes-seen-at-v1:${userId}`;

/**
 * Nº de curtidas recebidas desde a última vez que a aba "Reações" (tela de
 * notificações) foi aberta. Alimenta a bolinha vermelha no sino.
 */
export function useUnseenFeedLikesCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      (async () => {
        try {
          const since = await AsyncStorage.getItem(seenKey(user.id));
          const total = await getFeedLikesCountSince(user.id, since);
          if (!cancelled) setCount(total);
        } catch {
          // Sem contagem, sem bolinha — não trava a tela por causa disso.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  return count;
}

/** Marca as curtidas como vistas (chamado ao abrir a aba "Reações"). */
export async function markFeedLikesSeen(userId: string) {
  await AsyncStorage.setItem(seenKey(userId), new Date().toISOString());
}
