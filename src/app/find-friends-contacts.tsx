import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Linking as LinkingApi,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { FriendStatusButton } from '@/components/friend-status-button';
import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useFriendRelations } from '@/hooks/use-friend-relations';
import { useTheme } from '@/hooks/use-theme';
import { readDeviceContactPhoneNumbers, requestContactsPermission } from '@/lib/contacts';
import { matchContacts, profileDisplayName, type Profile } from '@/lib/db';
import {
  defaultCountryForLanguage,
  hashPhoneNumber,
  normalizePhoneNumber,
  phoneMatchVariants,
} from '@/lib/phone';

export default function FindFriendsContactsScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  const [scanning, setScanning] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [matches, setMatches] = useState<Profile[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const { busyIds, error: friendError, setError: setFriendError, statusFor, send, accept, remove } =
    useFriendRelations(user?.id);
  const [confirming, setConfirming] = useState<{ profile: Profile; kind: 'friend' | 'outgoing' } | null>(
    null
  );

  async function handleScanContacts() {
    setScanError(null);
    setPermissionDenied(false);
    const granted = await requestContactsPermission();
    if (!granted) {
      setPermissionDenied(true);
      return;
    }
    setScanning(true);
    try {
      const country = defaultCountryForLanguage(i18n.language);
      const rawNumbers = await readDeviceContactPhoneNumbers();
      // Quem salvou o contato pode ter digitado sem código do país ou sem
      // DDD — manda hash de cada variante pra não perder esse match (ver
      // phoneMatchVariants).
      const variants = new Set<string>();
      for (const raw of rawNumbers) {
        const number = normalizePhoneNumber(raw, country);
        if (!number) continue;
        for (const variant of phoneMatchVariants(number)) variants.add(variant);
      }
      const hashes = await Promise.all(Array.from(variants).map(hashPhoneNumber));
      const found = await matchContacts(hashes);
      setMatches(found);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : t('findFriendsContacts.scanError'));
    } finally {
      setScanning(false);
    }
  }

  const handleSend = (profile: Profile) => send(profile, t('friends.actionError'));
  const handleAccept = (profile: Profile) => accept(profile, t('friends.actionError'));
  const handleRemoveFriend = (profile: Profile) => remove(profile, t('friends.actionError'));

  function renderMatch({ item }: { item: Profile }) {
    return (
      <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          hitSlop={6}
          style={styles.rowIdentity}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}>
          <UserAvatar avatarId={item.avatar_id} name={profileDisplayName(item)} size={40} />
          <View style={styles.rowInfo}>
            <ThemedText type="smallBold">{profileDisplayName(item)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              @{item.username}
            </ThemedText>
          </View>
        </Pressable>
        <FriendStatusButton
          status={statusFor(item.id)}
          busy={busyIds.has(item.id)}
          onSend={() => handleSend(item)}
          onAccept={() => handleAccept(item)}
          onRequestRemove={() => setConfirming({ profile: item, kind: 'friend' })}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('findFriendsContacts.privacyExplanation')}
      </ThemedText>

      <Pressable
        disabled={scanning}
        style={[styles.scanButton, { backgroundColor: theme.accent, opacity: scanning ? 0.6 : 1 }]}
        onPress={handleScanContacts}>
        {scanning ? (
          <ActivityIndicator color={theme.accentText} />
        ) : (
          <>
            <Ionicons name="people-outline" size={20} color={theme.accentText} />
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('findFriendsContacts.scanButton')}
            </ThemedText>
          </>
        )}
      </Pressable>

      {permissionDenied && (
        <View style={styles.messageBlock}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {t('findFriendsContacts.permissionDenied')}
          </ThemedText>
          <Pressable onPress={() => LinkingApi.openSettings()}>
            <ThemedText type="linkPrimary">{t('findFriendsContacts.openSettings')}</ThemedText>
          </Pressable>
        </View>
      )}

      {(scanError || friendError) && (
        <ThemedText type="small" themeColor="danger" style={styles.message}>
          {scanError || friendError}
        </ThemedText>
      )}

      <FlatList
        data={matches ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          matches !== null ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              {t('findFriendsContacts.noMatches')}
            </ThemedText>
          ) : null
        }
        renderItem={renderMatch}
      />

      <ActionSheet
        visible={confirming !== null}
        title={
          confirming
            ? t('friends.unfriendConfirmTitle', { name: profileDisplayName(confirming.profile) })
            : undefined
        }
        options={
          confirming
            ? [
                {
                  label: t('friends.unfriend'),
                  icon: 'person-remove-outline',
                  destructive: true,
                  onPress: () => handleRemoveFriend(confirming.profile),
                },
              ]
            : []
        }
        onClose={() => {
          setConfirming(null);
          setFriendError(null);
        }}
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
  scanButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 14,
  },
  messageBlock: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  message: {
    textAlign: 'center',
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
  rowIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowInfo: {
    flex: 1,
    gap: Spacing.half,
  },
});
