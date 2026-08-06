import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { markFeedLikesSeen } from '@/hooks/use-unseen-feed-likes-count';
import {
  errorMessage,
  getFeedLikesReceived,
  getFollowedShows,
  getIncomingFriendRequests,
  getWatchedCounts,
  getWatchedMoviesByIds,
  profileDisplayName,
  type FollowedShow,
  type MediaType,
  type Profile,
} from '@/lib/db';
import { i18n } from '@/lib/i18n';
import { localizedTitle } from '@/lib/locale';
import { relativeDate } from '@/lib/relative-date';
import { airedEpisodeCount, getShowDetailsCached, posterUrl } from '@/lib/tmdb';

interface NewEpisodesItem {
  show: FollowedShow;
  /** Episódios já exibidos e ainda não assistidos. */
  newCount: number;
  /** Total de episódios exibidos no momento — usado para lembrar o que já foi limpo. */
  aired: number;
}

interface LikeItem {
  liker: Profile;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  created_at: string;
}

type NotificationsView = 'novidades' | 'reacoes';

/** tmdb_id → quantidade de episódios exibidos na última vez que a notificação foi limpa. */
type DismissedMap = Record<number, number>;

const dismissedKey = (userId: string) => `notifications-dismissed-v1:${userId}`;

/** Linha de um pedido de amizade pendente: leva à tela de Amigos para aceitar/recusar. */
function FriendRequestRow({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Link href="/friends" asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
        <UserAvatar avatarId={profile.avatar_id} name={profileDisplayName(profile)} size={40} />
        <View style={styles.info}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {profileDisplayName(profile)}
          </ThemedText>
          <ThemedText type="small" themeColor="accent">
            {t('notifications.wantsToBeFriend')}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>
    </Link>
  );
}

/** Linha de uma série com episódios novos: leva à tela da série, ou dispensa com o X. */
function NotificationRow({
  show,
  newCount,
  onDismiss,
}: {
  show: FollowedShow;
  newCount: number;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const uri = posterUrl(show.poster_path, 'w185');
  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_id) } }} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.poster}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(show.tmdb_id)}
          />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.info}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {localizedTitle(show.name, show.name_en, i18n.language)}
          </ThemedText>
          <ThemedText type="small" themeColor="accent">
            {t('notifications.newEpisodesCount', { count: newCount })}
          </ThemedText>
        </View>
        <Pressable hitSlop={8} onPress={onDismiss}>
          <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
        </Pressable>
      </Pressable>
    </Link>
  );
}

/** Linha de uma curtida recebida: leva à série/filme curtido. */
function LikeRow({ item }: { item: LikeItem }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const uri = posterUrl(item.poster_path, 'w185');
  const href =
    item.media_type === 'movie'
      ? ({ pathname: '/movie/[id]', params: { id: String(item.tmdb_id) } } as const)
      : ({ pathname: '/show/[id]', params: { id: String(item.tmdb_id) } } as const);
  return (
    <Link href={href} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
        <UserAvatar avatarId={item.liker.avatar_id} name={profileDisplayName(item.liker)} size={40} />
        <View style={styles.info}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {profileDisplayName(item.liker)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {t('notifications.liked')} <ThemedText type="smallBold">{item.title}</ThemedText>
          </ThemedText>
        </View>
        {uri ? (
          <Image source={{ uri }} style={styles.likePoster} contentFit="cover" />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {relativeDate(item.created_at)}
        </ThemedText>
      </Pressable>
    </Link>
  );
}

/** Séries seguidas com episódios já exibidos que o usuário ainda não assistiu, pedidos de amizade e curtidas recebidas. */
export default function NotificationsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  // Notificações de curtida abrem direto na aba "Reações" (ver use-notification-navigation).
  const { view: initialView } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<NotificationsView>(
    initialView === 'reacoes' ? 'reacoes' : 'novidades'
  );

  const [items, setItems] = useState<NewEpisodesItem[] | null>(null);
  const [friendRequests, setFriendRequests] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [likes, setLikes] = useState<LikeItem[] | null>(null);
  const [likesError, setLikesError] = useState<string | null>(null);

  const loadLikes = useCallback(async () => {
    if (!user) return;
    try {
      setLikesError(null);
      const received = await getFeedLikesReceived(user.id);
      const tvIds = [...new Set(received.filter((r) => r.media_type === 'tv').map((r) => r.tmdb_id))];
      const movieIds = [
        ...new Set(received.filter((r) => r.media_type === 'movie').map((r) => r.tmdb_id)),
      ];
      const [showEntries, movieRows] = await Promise.all([
        Promise.all(
          tvIds.map(async (id) => {
            try {
              const details = await getShowDetailsCached(id);
              return [id, { title: details.name, poster_path: details.poster_path }] as const;
            } catch {
              return [id, { title: t('notifications.showFallback', { id }), poster_path: null }] as const;
            }
          })
        ),
        getWatchedMoviesByIds(user.id, movieIds),
      ]);
      const showMap = new Map(showEntries);
      const movieMap = new Map(
        movieRows.map((m) => [
          m.tmdb_id,
          { title: localizedTitle(m.title, m.title_en, i18n.language), poster_path: m.poster_path },
        ])
      );
      setLikes(
        received.map((r) => {
          const info = r.media_type === 'movie' ? movieMap.get(r.tmdb_id) : showMap.get(r.tmdb_id);
          return {
            liker: r.liker,
            media_type: r.media_type,
            tmdb_id: r.tmdb_id,
            title: info?.title ?? (r.media_type === 'movie' ? t('notifications.aMovie') : t('notifications.aShow')),
            poster_path: info?.poster_path ?? null,
            created_at: r.created_at,
          };
        })
      );
    } catch (err) {
      setLikesError(errorMessage(err, t('notifications.loadLikesError')));
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      if (view === 'reacoes') {
        loadLikes();
        markFeedLikesSeen(user.id).catch(() => {});
        return;
      }

      let cancelled = false;
      setError(null);
      getIncomingFriendRequests(user.id)
        .then((requests) => {
          if (!cancelled) setFriendRequests(requests);
        })
        .catch(() => {});
      (async () => {
        try {
          const [shows, counts, dismissedRaw] = await Promise.all([
            getFollowedShows(user.id),
            getWatchedCounts(),
            AsyncStorage.getItem(dismissedKey(user.id)),
          ]);
          const dismissed: DismissedMap = dismissedRaw ? JSON.parse(dismissedRaw) : {};
          const watchedById = Object.fromEntries(
            counts.map((count) => [count.tmdb_show_id, count.episode_count])
          );
          const withNewCount = await Promise.all(
            shows.map(async (show) => {
              try {
                const details = await getShowDetailsCached(show.tmdb_id);
                const aired = airedEpisodeCount(details) ?? 0;
                const watched = watchedById[show.tmdb_id] ?? 0;
                return { show, newCount: Math.max(aired - watched, 0), aired };
              } catch {
                return { show, newCount: 0, aired: 0 };
              }
            })
          );
          if (cancelled) return;
          setItems(
            withNewCount
              // Já limpa nesta contagem de episódios exibidos? Só volta a aparecer
              // quando sair mais um episódio (aired sobe de novo).
              .filter((item) => item.newCount > 0 && dismissed[item.show.tmdb_id] !== item.aired)
              .sort((a, b) => b.newCount - a.newCount)
          );
        } catch (err) {
          if (!cancelled) setError(errorMessage(err, t('notifications.loadNewsError')));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [view, user, loadLikes])
  );

  async function persistDismissed(entries: [number, number][]) {
    if (!user) return;
    const raw = await AsyncStorage.getItem(dismissedKey(user.id));
    const dismissed: DismissedMap = raw ? JSON.parse(raw) : {};
    for (const [id, aired] of entries) dismissed[id] = aired;
    await AsyncStorage.setItem(dismissedKey(user.id), JSON.stringify(dismissed));
  }

  function dismissOne(item: NewEpisodesItem) {
    setItems((prev) => (prev ?? []).filter((i) => i.show.tmdb_id !== item.show.tmdb_id));
    persistDismissed([[item.show.tmdb_id, item.aired]]).catch(() => {});
  }

  function clearAll() {
    if (!items || items.length === 0) return;
    Alert.alert(t('notifications.clearNotificationsTitle'), t('notifications.clearNotificationsMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('notifications.clear'),
        style: 'destructive',
        onPress: () => {
          const current = items;
          setItems([]);
          persistDismissed(current.map((item) => [item.show.tmdb_id, item.aired])).catch(() => {});
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
        {(
          [
            { value: 'novidades', label: t('notifications.tabNews'), icon: 'sparkles-outline' },
            { value: 'reacoes', label: t('notifications.tabReactions'), icon: 'heart-outline' },
          ] as const
        ).map((option) => (
          <Pressable
            key={option.value}
            style={[styles.segment, view === option.value && { backgroundColor: theme.accent }]}
            onPress={() => setView(option.value)}>
            <Ionicons
              name={option.icon}
              size={13}
              color={view === option.value ? theme.accentText : theme.textSecondary}
            />
            <ThemedText
              type="small"
              numberOfLines={1}
              style={[
                styles.segmentText,
                { color: view === option.value ? theme.accentText : theme.textSecondary },
              ]}>
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {view === 'novidades' ? (
        error ? (
          <View style={styles.center}>
            <ThemedText themeColor="danger" style={styles.message}>
              {error}
            </ThemedText>
          </View>
        ) : items === null ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={items}
            // Os nomes de série vêm de localizedTitle(), que depende do idioma
            // ativo, não do array "items" em si — sem isso a lista não
            // re-renderiza sozinha ao trocar de idioma (ver FlatList.extraData).
            extraData={i18n.language}
            keyExtractor={(item) => String(item.show.tmdb_id)}
            contentContainerStyle={[
              styles.list,
              !items.length && !friendRequests.length && styles.listEmpty,
            ]}
            ListHeaderComponent={
              friendRequests.length > 0 || items.length > 0 ? (
                <>
                  {friendRequests.length > 0 && (
                    <View style={styles.section}>
                      <ThemedText type="smallBold" style={styles.sectionTitle}>
                        {t('notifications.friendRequestsHeader', { count: friendRequests.length })}
                      </ThemedText>
                      {friendRequests.map((profile) => (
                        <FriendRequestRow key={profile.id} profile={profile} />
                      ))}
                    </View>
                  )}
                  {items.length > 0 && (
                    <Pressable style={styles.clearAllButton} hitSlop={8} onPress={clearAll}>
                      <ThemedText type="small" themeColor="accent">
                        {t('notifications.clearAll')}
                      </ThemedText>
                    </Pressable>
                  )}
                </>
              ) : null
            }
            ListEmptyComponent={
              friendRequests.length === 0 ? (
                <View style={styles.center}>
                  <ThemedText type="subtitle" style={styles.message}>
                    {t('notifications.noNewsTitle')}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.message}>
                    {t('notifications.noNewsBody')}
                  </ThemedText>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <NotificationRow
                show={item.show}
                newCount={item.newCount}
                onDismiss={() => dismissOne(item)}
              />
            )}
          />
        )
      ) : likesError ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {likesError}
          </ThemedText>
        </View>
      ) : likes === null ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={likes}
          extraData={i18n.language}
          keyExtractor={(item, index) =>
            `${item.liker.id}:${item.media_type}:${item.tmdb_id}:${item.created_at}:${index}`
          }
          contentContainerStyle={[styles.list, !likes.length && styles.listEmpty]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="heart-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="subtitle" style={styles.message}>
                {t('notifications.noLikesTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                {t('notifications.noLikesBody')}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => <LikeRow item={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: Spacing.one,
    paddingVertical: 8,
  },
  segmentText: {
    fontSize: 12,
    lineHeight: 16,
  },
  list: {
    padding: Spacing.two,
  },
  listEmpty: {
    flexGrow: 1,
  },
  clearAllButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  section: {
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: Spacing.one,
    marginBottom: Spacing.one,
  },
  poster: {
    width: 40,
    height: 60,
    borderRadius: 4,
  },
  likePoster: {
    width: 32,
    height: 48,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    gap: 2,
  },
});
