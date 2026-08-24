import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import type { CountryCode } from 'libphonenumber-js';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { BadgeDot } from '@/components/badge-dot';
import { LanguageSelector } from '@/components/language-selector';
import { PhoneInput } from '@/components/phone-input';
import { ThemedText } from '@/components/themed-text';
import { ThemeSelector } from '@/components/theme-selector';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useIncomingFriendRequestCount } from '@/hooks/use-incoming-friend-request-count';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { AVATAR_IDS, avatarSource } from '@/lib/avatars';
import {
  deleteAccount,
  getMyPhoneNumber,
  getProfile,
  profileDisplayName,
  removePhoneNumber,
  setPhoneNumber,
  updateAvatar,
  updateDisplayName,
  type Profile,
} from '@/lib/db';
import { inviteStoreUrl, shareInvite } from '@/lib/invite';
import { unregisterPushToken } from '@/lib/notifications';
import { defaultCountryForLanguage, normalizePhoneNumber } from '@/lib/phone';

/** Mostra só os 4 últimos dígitos, o resto vira "•" (mesma quantidade de caracteres). */
function maskPhoneNumber(e164: string): string {
  if (e164.length <= 4) return e164;
  return '•'.repeat(e164.length - 4) + e164.slice(-4);
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const friendRequestCount = useIncomingFriendRequestCount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumberState] = useState<string | null | undefined>(undefined);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('BR');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getProfile(user.id)
        .then((data) => setProfile(data))
        .catch(() => {});
    }, [user])
  );

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getMyPhoneNumber(user.id)
        .then(setPhoneNumberState)
        .catch(() => setPhoneNumberState(null));
    }, [user])
  );

  function startEditingPhone() {
    setPhoneCountry(defaultCountryForLanguage(i18n.language));
    setPhoneDigits('');
    setPhoneError(null);
    setEditingPhone(true);
  }

  async function handleSavePhone() {
    setPhoneError(null);
    const normalized = normalizePhoneNumber(phoneDigits, phoneCountry);
    if (!normalized) {
      setPhoneError(t('findFriendsContacts.invalidPhone'));
      return;
    }
    setPhoneBusy(true);
    try {
      await setPhoneNumber(normalized);
      setPhoneNumberState(normalized);
      setEditingPhone(false);
      setPhoneDigits('');
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : t('common.genericError'));
    } finally {
      setPhoneBusy(false);
    }
  }

  async function handleRemovePhone() {
    if (!user) return;
    setPhoneBusy(true);
    setPhoneError(null);
    try {
      await removePhoneNumber(user.id);
      setPhoneNumberState(null);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : t('common.genericError'));
    } finally {
      setPhoneBusy(false);
    }
  }

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
      setError(err instanceof Error ? err.message : t('profile.avatarSaveError'));
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
      setError(t('profile.nicknameLengthError'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(user.id, trimmed);
      setProfile((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.nicknameSaveError'));
    } finally {
      setSaving(false);
    }
  }

  function handleInvite() {
    shareInvite(
      t('profile.inviteMessage', { url: inviteStoreUrl() }),
      t('profile.inviteSubject')
    );
  }

  async function handleSignOut() {
    if (user) await unregisterPushToken(user.id);
    await signOut();
  }

  function handleDeleteAccount() {
    Alert.alert(
      t('profile.deleteAccountTitle'),
      t('profile.deleteAccountMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            setError(null);
            try {
              if (user) await unregisterPushToken(user.id);
              await deleteAccount();
              await signOut();
            } catch (err) {
              setError(err instanceof Error ? err.message : t('profile.deleteAccountError'));
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
              placeholder={t('profile.nicknamePlaceholder')}
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
            <View style={styles.nameRowLeft}>
              <ThemedText type="subtitle">
                {profile ? profileDisplayName(profile) : '…'}
              </ThemedText>
              <Pressable hitSlop={8} onPress={startEditing}>
                <Ionicons name="pencil" size={18} color={theme.accent} />
              </Pressable>
            </View>
            {!editingPhone && phoneNumber && (
              <View style={styles.phoneRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {maskPhoneNumber(phoneNumber)}
                </ThemedText>
                <Pressable hitSlop={8} disabled={phoneBusy} onPress={handleRemovePhone}>
                  <Ionicons name="trash-outline" size={16} color={theme.danger} />
                </Pressable>
              </View>
            )}
            {!editingPhone && phoneNumber === null && (
              <Pressable hitSlop={8} style={styles.phoneRow} onPress={startEditingPhone}>
                <Ionicons name="call-outline" size={16} color={theme.accent} />
                <ThemedText type="small" style={{ color: theme.accent }}>
                  {t('findFriendsContacts.addPhone')}
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}

        {editingPhone && (
          <View style={styles.editRow}>
            <PhoneInput
              countryCode={phoneCountry}
              nationalNumber={phoneDigits}
              onChangeCountryCode={setPhoneCountry}
              onChangeNationalNumber={setPhoneDigits}
              autoFocus
            />
            <Pressable
              hitSlop={8}
              disabled={phoneBusy}
              onPress={handleSavePhone}
              style={[styles.iconButton, { backgroundColor: theme.accent, opacity: phoneBusy ? 0.6 : 1 }]}>
              {phoneBusy ? (
                <ActivityIndicator size="small" color={theme.accentText} />
              ) : (
                <Ionicons name="checkmark" size={18} color={theme.accentText} />
              )}
            </Pressable>
            <Pressable
              hitSlop={8}
              disabled={phoneBusy}
              onPress={() => {
                setEditingPhone(false);
                setPhoneDigits('');
                setPhoneError(null);
              }}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
        )}
        {phoneError && (
          <ThemedText type="small" themeColor="danger">
            {phoneError}
          </ThemedText>
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
              {t('profile.chooseAvatar')}
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
          onPress={() => router.push('/favorites')}>
          <Ionicons name="star" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.favorites')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/to-watch')}>
          <Ionicons name="bookmark" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.toWatch')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/stats')}>
          <Ionicons name="stats-chart" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.stats')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/friends')}>
          <BadgeDot visible={friendRequestCount > 0} />
          <Ionicons name="people" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.friends')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/import-tv-time')}>
          <Ionicons name="cloud-download" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.importTvTime')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={handleInvite}>
          <Ionicons name="person-add" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('profile.inviteFriends')}
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push('/notification-settings')}>
          <Ionicons name="notifications-outline" size={22} color={theme.accent} />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('common.nav.notifications')}
          </ThemedText>
        </Pressable>

        <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
          <ThemeSelector />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('profile.theme')}
          </ThemedText>
        </View>

        <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
          <LanguageSelector />
          <ThemedText type="smallBold" style={styles.tileLabel}>
            {t('profile.language')}
          </ThemedText>
        </View>

        <Pressable
          style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
          onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={22} color={theme.danger} />
          <ThemedText type="smallBold" themeColor="danger" style={styles.tileLabel}>
            {t('profile.signOut')}
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
            {deleting ? t('profile.deletingAccount') : t('profile.deleteAccount')}
          </ThemedText>
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
        {t('profile.credit')}
      </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // Nome + lápis de editar, agrupados à esquerda (o telefone fica à direita,
  // ver phoneRow, no mesmo nameRow).
  nameRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // Telefone, à direita na altura do nome — mais alto que @usuário/e-mail
  // pra não ficar sozinho e "flutuando" numa linha vazia lá embaixo.
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
