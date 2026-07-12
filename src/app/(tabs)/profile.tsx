import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { AVATAR_IDS, avatarSource } from '@/lib/avatars';
import {
  deleteAccount,
  getProfile,
  profileDisplayName,
  updateAvatar,
  updateDisplayName,
  type Profile,
} from '@/lib/db';
import { unregisterPushToken } from '@/lib/notifications';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getProfile(user.id)
        .then((data) => setProfile(data))
        .catch(() => {});
    }, [user])
  );

  async function handleChooseAvatar(avatarId: number) {
    if (!user) return;
    const previous = profile?.avatar_id ?? null;
    // Atualização otimista: mostra o avatar novo na hora e desfaz se falhar.
    setProfile((prev) => (prev ? { ...prev, avatar_id: avatarId } : prev));
    setChoosingAvatar(false);
    try {
      await updateAvatar(user.id, avatarId);
    } catch (err) {
      setProfile((prev) => (prev ? { ...prev, avatar_id: previous } : prev));
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o avatar.');
    }
  }

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

  function handleDeleteAccount() {
    Alert.alert(
      'Excluir conta',
      'Isso apaga sua conta e todos os seus dados (séries, avaliações, comentários, amizades) permanentemente. Essa ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            setError(null);
            try {
              if (user) await unregisterPushToken(user.id);
              await deleteAccount();
              await signOut();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Não foi possível excluir a conta.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.avatarRow}>
          <Pressable hitSlop={4} onPress={() => setChoosingAvatar(true)}>
            <UserAvatar
              avatarId={profile?.avatar_id}
              name={profile ? profileDisplayName(profile) : '?'}
              size={64}
            />
            <View style={[styles.avatarEditBadge, { backgroundColor: theme.accent }]}>
              <Ionicons name="pencil" size={12} color={theme.accentText} />
            </View>
          </Pressable>
        </View>
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

      <Modal
        visible={choosingAvatar}
        transparent
        animationType="fade"
        onRequestClose={() => setChoosingAvatar(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setChoosingAvatar(false)}>
          <Pressable
            style={[styles.avatarModal, { backgroundColor: theme.backgroundElement }]}
            // Impede que o toque dentro do cartão feche o modal.
            onPress={(event) => event.stopPropagation()}>
            <ThemedText type="subtitle" style={styles.avatarModalTitle}>
              Escolha seu avatar
            </ThemedText>
            <View style={styles.avatarGrid}>
              {AVATAR_IDS.map((avatarId) => {
                const selected = profile?.avatar_id === avatarId;
                return (
                  <Pressable
                    key={avatarId}
                    style={[
                      styles.avatarOption,
                      selected && { borderColor: theme.accent, borderWidth: 3 },
                    ]}
                    onPress={() => handleChooseAvatar(avatarId)}>
                    <Image
                      source={avatarSource(avatarId)!}
                      style={styles.avatarOptionImage}
                      contentFit="cover"
                    />
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.grid}>
        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/stats')}>
          <Ionicons name="stats-chart" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Estatísticas
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/friends')}>
          <Ionicons name="people" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Encontrar amigos
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/import-tv-time')}>
          <Ionicons name="cloud-download" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Importar do TV Time
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/blocked-users')}>
          <Ionicons name="hand-left" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Bloqueados
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={22} color={theme.danger} />
          <ThemedText type="smallBold" themeColor="danger" style={styles.tileLabel}>
            Sair da conta
          </ThemedText>
        </Pressable>

        <Pressable
          disabled={deleting}
          style={[
            styles.tile,
            { backgroundColor: theme.backgroundElement, opacity: deleting ? 0.6 : 1 },
          ]}
          onPress={handleDeleteAccount}>
          <Ionicons name="trash-outline" size={22} color={theme.danger} />
          <ThemedText type="smallBold" themeColor="danger" style={styles.tileLabel}>
            {deleting ? 'Excluindo…' : 'Excluir conta'}
          </ThemedText>
        </Pressable>
      </View>

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
  avatarRow: {
    flexDirection: 'row',
    marginBottom: Spacing.one,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderRadius: 999,
    padding: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  avatarModal: {
    borderRadius: 16,
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 360,
  },
  avatarModalTitle: {
    textAlign: 'center',
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  avatarOption: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  avatarOptionImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tile: {
    // Dois por linha: 45% de base + grow preenche a linha junto com o gap.
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 12,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: Spacing.one,
  },
  tileLabel: {
    textAlign: 'center',
  },
  credit: {
    textAlign: 'center',
    marginTop: 'auto',
    marginBottom: Spacing.three,
  },
});
