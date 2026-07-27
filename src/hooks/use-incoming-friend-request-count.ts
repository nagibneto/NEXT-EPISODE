import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getIncomingFriendRequests } from '@/lib/db';

/**
 * Nº de pedidos de amizade pendentes recebidos, atualizado sempre que a tela
 * que usa o hook ganha foco. Alimenta a bolinha vermelha no sino de
 * notificações e no atalho "Amigos" do Perfil.
 */
export function useIncomingFriendRequestCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getIncomingFriendRequests(user.id)
        .then((requests) => setCount(requests.length))
        .catch(() => {});
    }, [user])
  );

  return count;
}
