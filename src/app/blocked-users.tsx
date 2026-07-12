import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getBlockedUsers, profileDisplayName, unblockUser, type Profile } from '@/lib/db';

export default function BlockedUsersScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [blocked, setBlocked] = useState<Profile[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    getBlockedUsers(user.id)
      .then(setBlocked)
      .catch(() => setBlocked([]));
  }, [user]);

  async function handleUnblock(profile: Profile) {
    if (!user) return;
    setBusyIds((prev) => new Set(prev).add(profile.id));
    try {
      await unblockUser(user.id, profile.id);
      setBlocked((prev) => (prev ?? []).filter((p) => p.id !== profile.id));
    } catch {
      // Mantém a lista como está se o desbloqueio falhar.
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(profile.id);
        return next;
      });
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={blocked ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          blocked !== null ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              Você não bloqueou ninguém.
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <UserAvatar avatarId={item.avatar_id} name={profileDisplayName(item)} size={40} />
            <View style={styles.rowInfo}>
              <ThemedText type="smallBold">{profileDisplayName(item)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                @{item.username}
              </ThemedText>
            </View>
            <Pressable
              disabled={busyIds.has(item.id)}
              onPress={() => handleUnblock(item)}
              style={[styles.button, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">Desbloquear</ThemedText>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
  },
  list: {
    gap: Spacing.two,
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
  button: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
