import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import type { CountryCode } from 'libphonenumber-js';
import { useCallback, useState, type ReactNode } from 'react';
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
import { QuizCard } from '@/components/quiz-card';
import { ThemedText } from '@/components/themed-text';
import { ThemeSelector } from '@/components/theme-selector';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Spacing } from '@/constants/theme';
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

/** Título de uma seção do perfil ("Sua coleção", "Preferências"…). */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" style={styles.sectionTitle}>
      {children}
    </ThemedText>
  );
}

/**
 * Linha de uma lista agrupada: ícone + rótulo à esquerda e, à direita, um
 * chevron (quando navega) ou um controle próprio (Tema/Idioma). A divisória
 * some na primeira linha do grupo.
 */
function SettingsRow({
  icon,
  label,
  danger = false,
  first = false,
  badge = false,
  right,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  first?: boolean;
  badge?: boolean;
  right?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.accent;
  const content = (
    <>
      <View>
        <Ionicons name={icon} size={22} color={color} />
        <BadgeDot visible={badge} />
      </View>
      <ThemedText
        type="smallBold"
        themeColor={danger ? 'danger' : 'text'}
        numberOfLines={1}
        style={styles.rowLabel}>
        {label}
      </ThemedText>
      {right ?? <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />}
    </>
  );

  const style = [
    styles.row,
    !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.background },
    disabled && styles.rowDisabled,
  ];

  // Sem onPress a linha é só um contêiner (ex.: Tema, que já tem o seletor).
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable style={style} disabled={disabled} onPress={onPress}>
      {content}
    </Pressable>
  );
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

  function toggleEditing() {
    if (editing) {
      setEditing(false);
      return;
    }
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
    shareInvite(t('profile.inviteMessage', { url: inviteStoreUrl() }), t('profile.inviteSubject'));
  }

  async function handleSignOut() {
    if (user) await unregisterPushToken(user.id);
    await signOut();
  }

  function handleDeleteAccount() {
    Alert.alert(t('profile.deleteAccountTitle'), t('profile.deleteAccountMessage'), [
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
    ]);
  }

  /** Atalho da seção "Sua coleção": ícone, rótulo e chevron, dois por linha. */
  function CollectionTile({
    icon,
    label,
    badge = false,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    badge?: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable
        style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
        onPress={onPress}>
        <View>
          <Ionicons name={icon} size={22} color={theme.accent} />
          <BadgeDot visible={badge} />
        </View>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.tileLabel}>
          {label}
        </ThemedText>
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Cabeçalho: avatar, nome/@usuário e o botão que abre a edição. */}
        <View style={styles.header}>
          <Pressable hitSlop={4} onPress={() => setChoosingAvatar(true)}>
            <UserAvatar
              avatarId={profile?.avatar_id}
              name={profile ? profileDisplayName(profile) : '?'}
              size={72}
            />
            <View style={[styles.avatarEditBadge, { backgroundColor: theme.accent }]}>
              <Ionicons name="pencil" size={12} color={theme.accentText} />
            </View>
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText type="subtitle" numberOfLines={1} style={styles.headerName}>
              {profile ? profileDisplayName(profile) : '…'}
            </ThemedText>
            {profile && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                @{profile.username}
              </ThemedText>
            )}
          </View>
          <Pressable
            style={[styles.editButton, { borderColor: theme.backgroundSelected }]}
            onPress={toggleEditing}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {editing ? t('common.close') : t('profile.editProfile')}
            </ThemedText>
          </Pressable>
        </View>

        {editing && (
          <View style={[styles.editCard, { backgroundColor: theme.backgroundElement }]}>
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
                style={[
                  styles.iconButton,
                  { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 },
                ]}>
                <Ionicons name="checkmark" size={18} color={theme.accentText} />
              </Pressable>
            </View>

            {editingPhone ? (
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
                  style={[
                    styles.iconButton,
                    { backgroundColor: theme.accent, opacity: phoneBusy ? 0.6 : 1 },
                  ]}>
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
            ) : phoneNumber ? (
              <View style={styles.phoneRow}>
                <Ionicons name="call-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.phoneValue}>
                  {maskPhoneNumber(phoneNumber)}
                </ThemedText>
                <Pressable hitSlop={8} disabled={phoneBusy} onPress={handleRemovePhone}>
                  <Ionicons name="trash-outline" size={16} color={theme.danger} />
                </Pressable>
              </View>
            ) : phoneNumber === null ? (
              <Pressable hitSlop={8} style={styles.phoneRow} onPress={startEditingPhone}>
                <Ionicons name="call-outline" size={16} color={theme.accent} />
                <ThemedText type="small" style={{ color: theme.accent }}>
                  {t('findFriendsContacts.addPhone')}
                </ThemedText>
              </Pressable>
            ) : null}

            {phoneError && (
              <ThemedText type="small" themeColor="danger">
                {phoneError}
              </ThemedText>
            )}

            <View style={styles.phoneRow}>
              <Ionicons name="mail-outline" size={16} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {user?.email}
              </ThemedText>
            </View>
          </View>
        )}

        {error && (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        )}

        <QuizCard />

        <View style={styles.section}>
          <SectionTitle>{t('profile.sectionCollection')}</SectionTitle>
          <View style={styles.grid}>
            <CollectionTile
              icon="star"
              label={t('common.nav.favorites')}
              onPress={() => router.push('/favorites')}
            />
            <CollectionTile
              icon="bookmark"
              label={t('common.nav.toWatch')}
              onPress={() => router.push('/to-watch')}
            />
            <CollectionTile
              icon="stats-chart"
              label={t('common.nav.stats')}
              onPress={() => router.push('/stats')}
            />
            <CollectionTile
              icon="people"
              label={t('common.nav.friends')}
              badge={friendRequestCount > 0}
              onPress={() => router.push('/friends')}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t('profile.sectionPreferences')}</SectionTitle>
          <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>
            <SettingsRow
              first
              icon="notifications-outline"
              label={t('common.nav.notifications')}
              onPress={() => router.push('/notification-settings')}
            />
            <SettingsRow
              icon="moon-outline"
              label={t('profile.theme')}
              right={<ThemeSelector />}
            />
            <SettingsRow
              icon="language-outline"
              label={t('profile.language')}
              right={<LanguageSelector />}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t('profile.sectionConnections')}</SectionTitle>
          <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>
            <SettingsRow
              first
              icon="cloud-download"
              label={t('common.nav.importTvTime')}
              onPress={() => router.push('/import-tv-time')}
            />
            <SettingsRow
              icon="person-add"
              label={t('profile.inviteFriends')}
              onPress={handleInvite}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t('profile.sectionAccount')}</SectionTitle>
          <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>
            <SettingsRow
              first
              danger
              icon="log-out-outline"
              label={t('profile.signOut')}
              onPress={handleSignOut}
            />
            <SettingsRow
              danger
              disabled={deleting}
              icon="trash-outline"
              label={deleting ? t('profile.deletingAccount') : t('profile.deleteAccount')}
              onPress={handleDeleteAccount}
            />
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
          {t('profile.credit')}
        </ThemedText>
      </ScrollView>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  headerName: {
    fontSize: 26,
    lineHeight: 32,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderRadius: Radius.pill,
    padding: 4,
  },
  editButton: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 7,
  },
  editCard: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nicknameInput: {
    flex: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
  },
  iconButton: {
    borderRadius: Radius.sm,
    padding: 8,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  phoneValue: {
    flex: 1,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  tileLabel: {
    flex: 1,
  },
  group: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  rowLabel: {
    flex: 1,
  },
  rowControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  avatarOptionImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  credit: {
    textAlign: 'center',
    marginTop: 'auto',
    marginBottom: Spacing.three,
  },
});
