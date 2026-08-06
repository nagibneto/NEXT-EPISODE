import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { FriendStatusButton } from '@/components/friend-status-button';
import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useFriendRelations } from '@/hooks/use-friend-relations';
import { profileDisplayName, searchProfiles, type Profile } from '@/lib/db';

// Link de cada loja para o convite (ver friends.json / handleInvite abaixo).
const APP_STORE_URL = 'https://apps.apple.com/br/app/next-episode/id6789371179';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nagibneto.nextepisode';

export default function FriendsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const {
    friends,
    incoming,
    outgoing,
    busyIds,
    error,
    statusFor,
    send,
    accept,
    remove,
  } = useFriendRelations(user?.id);
  // Desfazer amizade e cancelar pedido pedem confirmação — são ações que o
  // usuário não consegue desfazer sozinho depois.
  const [confirming, setConfirming] = useState<{
    profile: Profile;
    kind: 'friend' | 'outgoing';
  } | null>(null);

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
          setSearchError(err instanceof Error ? err.message : t('friends.searchError'))
        );
    }, 350);
    return () => clearTimeout(timer);
  }, [query, user]);

  function handleInvite() {
    const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
    Share.share({ message: t('friends.inviteMessage', { url: storeUrl }) }).catch(() => {});
  }

  const handleSendRequest = (profile: Profile) => send(profile, t('friends.actionError'));
  const handleAccept = (profile: Profile) => accept(profile, t('friends.actionError'));
  const handleRemove = (profile: Profile) => remove(profile, t('friends.actionError'));

  function renderProfile({ item }: { item: Profile }) {
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
          onSend={() => handleSendRequest(item)}
          onAccept={() => handleAccept(item)}
          onRequestRemove={() => setConfirming({ profile: item, kind: 'friend' })}
        />
      </View>
    );
  }

  function renderIncomingRow(item: Profile) {
    const busy = busyIds.has(item.id);
    return (
      <View key={item.id} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          hitSlop={6}
          style={styles.rowIdentity}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}>
          <UserAvatar avatarId={item.avatar_id} name={profileDisplayName(item)} size={40} />
          <View style={styles.rowInfo}>
            <ThemedText type="smallBold">{profileDisplayName(item)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('friends.wantsToBeFriend', { username: item.username })}
            </ThemedText>
          </View>
        </Pressable>
        <View style={styles.requestButtons}>
          <Pressable
            disabled={busy}
            onPress={() => handleRemove(item)}
            style={[styles.smallButton, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">{t('friends.decline')}</ThemedText>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => handleAccept(item)}
            style={[styles.smallButton, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('friends.accept')}
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
          placeholder={t('friends.searchPlaceholder')}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <Pressable
        style={[styles.inviteButton, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/find-friends-contacts')}>
        <Ionicons name="people-outline" size={18} color={theme.text} />
        <ThemedText type="smallBold" style={styles.inviteLabel}>
          {t('friends.findViaContacts')}
        </ThemedText>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>

      <Pressable
        style={[styles.inviteButton, { backgroundColor: theme.backgroundElement }]}
        onPress={handleInvite}>
        <Ionicons name="share-outline" size={18} color={theme.text} />
        <ThemedText type="smallBold" style={styles.inviteLabel}>
          {t('friends.inviteFriends')}
        </ThemedText>
      </Pressable>

      {(error || searchError) && (
        <ThemedText type="small" themeColor="danger" style={styles.message}>
          {error || searchError}
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
                {t('friends.friendRequestsHeader', { count: incoming.length })}
              </ThemedText>
              {incoming.map(renderIncomingRow)}
            </View>
          ) : null
        }
        ListFooterComponent={
          !showingSearch && outgoing.length > 0 ? (
            <View style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                {t('friends.sentRequestsHeader', { count: outgoing.length })}
              </ThemedText>
              {outgoing.map((item) => (
                <View key={item.id}>{renderProfile({ item })}</View>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {showingSearch ? t('friends.noUsersFound') : t('friends.noFriendsYet')}
          </ThemedText>
        }
        renderItem={renderProfile}
      />

      <ActionSheet
        visible={confirming !== null}
        title={
          confirming?.kind === 'friend'
            ? t('friends.unfriendConfirmTitle', { name: profileDisplayName(confirming.profile) })
            : confirming
              ? t('friends.cancelRequestConfirmTitle', {
                  name: profileDisplayName(confirming.profile),
                })
              : undefined
        }
        options={
          confirming
            ? [
                {
                  label: confirming.kind === 'friend' ? t('friends.unfriend') : t('friends.cancelRequest'),
                  icon:
                    confirming.kind === 'friend' ? 'person-remove-outline' : 'close-circle-outline',
                  destructive: true,
                  onPress: () => handleRemove(confirming.profile),
                },
              ]
            : []
        }
        onClose={() => setConfirming(null)}
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
  // Avatar + nome levam ao perfil; o botão de ação fica fora para não roubar
  // o toque de quem só quer aceitar/remover.
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
});
