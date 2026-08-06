import { useCallback, useEffect, useState } from 'react';

import {
  acceptFriendRequest,
  getFriends,
  getIncomingFriendRequests,
  getOutgoingFriendRequests,
  removeFriendRequest,
  sendFriendRequest,
  type Profile,
} from '@/lib/db';

export type FriendStatus = 'friend' | 'incoming' | 'outgoing' | 'none';

/**
 * Amigos/pedidos do usuário logado + ações (pedir, aceitar, remover), com
 * estado de "carregando" por perfil. Extraído de friends.tsx para ser
 * reaproveitado também em find-friends-contacts.tsx — as duas telas mostram
 * o mesmo tipo de botão de status por perfil.
 */
export function useFriendRelations(userId: string | undefined) {
  const [friends, setFriends] = useState<Profile[]>([]);
  const [incoming, setIncoming] = useState<Profile[]>([]);
  const [outgoing, setOutgoing] = useState<Profile[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadRelations = useCallback(() => {
    if (!userId) return;
    Promise.all([
      getFriends(userId),
      getIncomingFriendRequests(userId),
      getOutgoingFriendRequests(userId),
    ])
      .then(([friendsList, incomingList, outgoingList]) => {
        setFriends(friendsList);
        setIncoming(incomingList);
        setOutgoing(outgoingList);
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    loadRelations();
  }, [loadRelations]);

  function statusFor(profileId: string): FriendStatus {
    if (friends.some((p) => p.id === profileId)) return 'friend';
    if (incoming.some((p) => p.id === profileId)) return 'incoming';
    if (outgoing.some((p) => p.id === profileId)) return 'outgoing';
    return 'none';
  }

  async function withBusy(id: string, action: () => Promise<void>, errorFallback: string) {
    if (!userId) return;
    setBusyIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      await action();
      loadRelations();
    } catch (err) {
      setError(err instanceof Error ? err.message : errorFallback);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const send = (profile: Profile, errorFallback: string) =>
    withBusy(profile.id, () => sendFriendRequest(userId!, profile.id), errorFallback);
  const accept = (profile: Profile, errorFallback: string) =>
    withBusy(profile.id, () => acceptFriendRequest(userId!, profile.id), errorFallback);
  const remove = (profile: Profile, errorFallback: string) =>
    withBusy(profile.id, () => removeFriendRequest(userId!, profile.id), errorFallback);

  return {
    friends,
    incoming,
    outgoing,
    busyIds,
    error,
    setError,
    statusFor,
    send,
    accept,
    remove,
    refresh: loadRelations,
  };
}
