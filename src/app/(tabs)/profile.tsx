import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemeSelector } from '@/components/theme-selector';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { usePremium } from '@/hooks/use-premium';
import { AVATAR_IDS, avatarSource, isPremiumAvatar } from '@/lib/avatars';
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
  const { isPremium } = usePremium();
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
    // Avatar premium sem assinatura: mostra o paywall em vez de salvar.
    if (isPremiumAvatar(avatarId) && !isPremium) {
      setChoosingAvatar(false);
      router.push('/paywall');
      return;
    }
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
        {/* Avatar grande à esquerda, textos à direita: aproveita a largura do cartão. */}
        <View style={styles.cardRow}>
          <Pressable hitSlop={4} onPress={() => setChoosingAvatar(true)}>
            <UserAvatar
              avatarId={profile?.avatar_id}
              name={profile ? profileDisplayName(profile) : '?'}
              size={88}
              premium={isPremium}
            />
            <View style={[styles.avatarEditBadge, { backgroundColor: theme.accent }]}>
              <Ionicons name="pencil" size={12} color={theme.accentText} />
            </View>
          </Pressable>
          <View style={styles.cardInfo}>
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
                  style={[
                    styles.iconButton,
                    { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 },
                  ]}>
                  <Ionicons name="checkmark" size={18} color={theme.accentText} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setEditing(false)}>
                  <Ionicons name="close" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <ThemedText type="subtitle" style={styles.nameText} numberOfLines={2}>
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
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {user?.email}
            </ThemedText>
          </View>
        </View>
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
            <ScrollView style={styles.avatarScroll}>
              <View style={styles.avatarGrid}>
                {AVATAR_IDS.map((avatarId) => {
                  const selected = profile?.avatar_id === avatarId;
                  const locked = isPremiumAvatar(avatarId) && !isPremium;
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
                        style={[styles.avatarOptionImage, locked && styles.avatarLockedImage]}
                        contentFit="cover"
                      />
                      {locked && (
                        <View style={styles.avatarLockBadge}>
                          <Ionicons name="lock-closed" size={14} color="#ffffff" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {!isPremium && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.avatarHint}>
                  Avatares com cadeado são exclusivos do premium.
                </ThemedText>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.grid}>
        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/paywall')}>
          <Ionicons name="sparkles" size={22} color={theme.gold} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {isPremium ? 'Você é premium' : 'Seja premium'}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/favorites')}>
          <Ionicons name="star" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Favoritos
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/to-watch')}>
          <Ionicons name="bookmark" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Para assistir
          </ThemedText>
        </Pressable>

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

        <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
          <ThemeSelector />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            Tema
          </ThemedText>
        </View>

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
            styles.tileHalfOnly,
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
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  cardInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  // O "subtitle" (32px) fica grande demais dividindo a linha com o avatar.
  nameText: {
    fontSize: 22,
    lineHeight: 28,
    flexShrink: 1,
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
  // Com 36 avatares o modal não cabe na tela: a grade rola por dentro.
  avatarScroll: {
    maxHeight: 400,
  },
  avatarHint: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  avatarLockedImage: {
    opacity: 0.45,
  },
  avatarLockBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 999,
    padding: 4,
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
  // Sozinho na última linha: sem grow para não esticar na largura toda
  // (excluir conta é o botão menos usado, não precisa de destaque).
  tileHalfOnly: {
    flexGrow: 0,
    flexBasis: '48%',
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
