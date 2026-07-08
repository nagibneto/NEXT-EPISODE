import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  getFollowedShows,
  getProfile,
  profileDisplayName,
  updateDisplayName,
  type Profile,
} from '@/lib/db';
import { unregisterPushToken } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followedCount, setFollowedCount] = useState<number | null>(null);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getProfile(user.id)
        .then((data) => setProfile(data))
        .catch(() => {});
      getFollowedShows(user.id)
        .then((shows) => setFollowedCount(shows.length))
        .catch(() => {});
      supabase
        .from('watched_episodes')
        .select('tmdb_show_id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(({ count }) => setWatchedCount(count ?? 0));
    }, [user])
  );

  function startEditing() {
    setNickname(profile ? profileDisplayName(profile) : '');
    setError(null);
    setEditing(true);
  }

  async function handleSaveNickname() {
    if (!user) return;
    const trimmed = nickname.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      setError('O apelido precisa ter entre 1 e 40 caracteres.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(user.id, trimmed);
      setProfile((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o apelido.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (user) await unregisterPushToken(user.id);
    await signOut();
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={[
                styles.nicknameInput,
                { backgroundColor: theme.backgroundSelected, color: theme.text },
              ]}
              placeholder="Seu apelido"
              placeholderTextColor={theme.textSecondary}
              maxLength={40}
              autoFocus
              value={nickname}
              onChangeText={setNickname}
              onSubmitEditing={handleSaveNickname}
            />
            <Pressable
              hitSlop={8}
              disabled={saving}
              onPress={handleSaveNickname}
              style={[styles.iconButton, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}>
              <Ionicons name="checkmark" size={18} color={theme.accentText} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setEditing(false)}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <ThemedText type="subtitle">
              {profile ? profileDisplayName(profile) : '…'}
            </ThemedText>
            <Pressable hitSlop={8} onPress={startEditing}>
              <Ionicons name="pencil" size={18} color={theme.accent} />
            </Pressable>
          </View>
        )}
        {profile && (
          <ThemedText type="small" themeColor="textSecondary">
            @{profile.username}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {user?.email}
        </ThemedText>
        {error && (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        )}
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.accent }}>
            {followedCount ?? '–'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Séries seguidas
          </ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={{ color: theme.accent }}>
            {watchedCount ?? '–'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Episódios assistidos
          </ThemedText>
        </View>
      </View>

      <Pressable
        style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/stats')}>
        <ThemedText type="smallBold" themeColor="accent">
          Estatísticas de tempo assistido
        </ThemedText>
      </Pressable>

      <Pressable
        style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/friends')}>
        <ThemedText type="smallBold" themeColor="accent">
          Encontrar amigos
        </ThemedText>
      </Pressable>

      <Pressable
        style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/import-tv-time')}>
        <ThemedText type="smallBold" themeColor="accent">
          Importar histórico do TV Time
        </ThemedText>
      </Pressable>

      <Pressable
        style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}
        onPress={handleSignOut}>
        <ThemedText type="smallBold" themeColor="danger">
          Sair da conta
        </ThemedText>
      </Pressable>

      <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
        Dados de séries fornecidos por TMDB (themoviedb.org).
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nicknameInput: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
  },
  iconButton: {
    borderRadius: 8,
    padding: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  actionButton: {
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
  },
  credit: {
    textAlign: 'center',
    marginTop: 'auto',
    marginBottom: Spacing.three,
  },
});
