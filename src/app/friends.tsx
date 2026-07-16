import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  acceptFriendRequest,
  getFriends,
  getIncomingFriendRequests,
  getOutgoingFriendRequests,
  profileDisplayName,
  removeFriendRequest,
  searchProfiles,
  sendFriendRequest,
  type Profile,
} from '@/lib/db';

type FriendStatus = 'friend' | 'incoming' | 'outgoing' | 'none';

export default function FriendsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [incoming, setIncoming] = useState<Profile[]>([]);
  const [outgoing, setOutgoing] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const loadRelations = useCallback(() => {
    if (!user) return;
    Promise.all([
      getFriends(user.id),
      getIncomingFriendRequests(user.id),
      getOutgoingFriendRequests(user.id),
    ])
      .then(([friendsList, incomingList, outgoingList]) => {
        setFriends(friendsList);
        setIncoming(incomingList);
        setOutgoing(outgoingList);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    loadRelations();
  }, [loadRelations]);

  // Busca com debounce simples enquanto o usuário digita.
  useEffect(() => {
    if (!user) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      searchProfiles(term, user.id)
        .then(setResults)
        .catch((err) =>
          setError(err instanceof Error ? err.message : 'Erro ao buscar usuários.')
        );
    }, 350);
    return () => clearTimeout(timer);
  }, [query, user]);

  function statusFor(profileId: string): FriendStatus {
    if (friends.some((p) => p.id === profileId)) return 'friend';
    if (incoming.some((p) => p.id === profileId)) return 'incoming';
    if (outgoing.some((p) => p.id === profileId)) return 'outgoing';
    return 'none';
  }

  async function withBusy(id: string, action: () => Promise<void>) {
    if (!user) return;
    setBusyIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      await action();
      loadRelations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const handleSendRequest = (profile: Profile) =>
    withBusy(profile.id, () => sendFriendRequest(user!.id, profile.id));
  const handleAccept = (profile: Profile) =>
    withBusy(profile.id, () => acceptFriendRequest(user!.id, profile.id));
  const handleRemove = (profile: Profile) =>
    withBusy(profile.id, () => removeFriendRequest(user!.id, profile.id));

  function renderStatusButton(profile: Profile) {
    const status = statusFor(profile.id);
    const busy = busyIds.has(profile.id);

    if (status === 'friend') {
      return (
        <Pressable
          disabled={busy}
          onPress={() => handleRemove(profile)}
          style={[styles.actionButton, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">Amigos</ThemedText>
        </Pressable>
      );
    }
    if (status === 'incoming') {
      return (
        <Pressable
          disabled={busy}
          onPress={() => handleAccept(profile)}
          style={[styles.actionButton, { backgroundColor: theme.accent }]}>
          <ThemedText type="smallBold" style={{ color: theme.accentText }}>
            Aceitar
          </ThemedText>
        </Pressable>
      );
    }
    if (status === 'outgoing') {
      return (
        <Pressable
          disabled={busy}
          onPress={() => handleRemove(profile)}
          style={[styles.actionButton, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Pendente
          </ThemedText>
        </Pressable>
      );
    }
    return (
      <Pressable
        disabled={busy}
        onPress={() => handleSendRequest(profile)}
        style={[styles.actionButton, { backgroundColor: theme.accent }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentText }}>
          Adicionar
        </ThemedText>
      </Pressable>
    );
  }

  function renderProfile({ item }: { item: Profile }) {
    return (
      <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <UserAvatar
          avatarId={item.avatar_id}
          name={profileDisplayName(item)}
          size={40}
          premium={item.is_premium}
        />
        <View style={styles.rowInfo}>
          <ThemedText type="smallBold">{profileDisplayName(item)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            @{item.username}
          </ThemedText>
        </View>
        {renderStatusButton(item)}
      </View>
    );
  }

  function renderIncomingRow(item: Profile) {
    const busy = busyIds.has(item.id);
    return (
      <View key={item.id} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <UserAvatar
          avatarId={item.avatar_id}
          name={profileDisplayName(item)}
          size={40}
          premium={item.is_premium}
        />
        <View style={styles.rowInfo}>
          <ThemedText type="smallBold">{profileDisplayName(item)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            @{item.username} quer ser seu amigo
          </ThemedText>
        </View>
        <View style={styles.requestButtons}>
          <Pressable
            disabled={busy}
            onPress={() => handleRemove(item)}
            style={[styles.smallButton, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">Recusar</ThemedText>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => handleAccept(item)}
            style={[styles.smallButton, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              Aceitar
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const showingSearch = results !== null;
  const list = showingSearch ? results : friends;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Buscar por nome de usuário ou apelido…"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {/* TODO: habilitar quando o link de convite (deep link) estiver pronto. */}
      <Pressable
        disabled
        style={[styles.inviteButton, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="share-outline" size={18} color={theme.textSecondary} />
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.inviteLabel}>
          Convidar amigos
        </ThemedText>
        <View style={[styles.soonBadge, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Em breve
          </ThemedText>
        </View>
      </Pressable>

      {error && (
        <ThemedText type="small" themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      )}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          !showingSearch && incoming.length > 0 ? (
            <View style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Pedidos de amizade ({incoming.length})
              </ThemedText>
              {incoming.map(renderIncomingRow)}
            </View>
          ) : null
        }
        ListFooterComponent={
          !showingSearch && outgoing.length > 0 ? (
            <View style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Pedidos enviados ({outgoing.length})
              </ThemedText>
              {outgoing.map((item) => (
                <View key={item.id}>{renderProfile({ item })}</View>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {showingSearch
              ? 'Nenhum usuário encontrado.'
              : 'Você ainda não tem amigos. Busque um usuário acima para mandar um pedido.'}
          </ThemedText>
        }
        renderItem={renderProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
  },
  list: {
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  actionButton: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  requestButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  smallButton: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    gap: Spacing.two,
  },
  inviteLabel: {
    flex: 1,
  },
  soonBadge: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
});
