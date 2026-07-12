import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getFriendsFeed, profileDisplayName, type FeedItem } from '@/lib/db';
import { getShowDetailsCached, posterUrl } from '@/lib/tmdb';

interface ShowInfo {
  name: string;
  poster_path: string | null;
}

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

function relativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return date.toLocaleDateString('pt-BR');
}

export default function FeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [shows, setShows] = useState<Map<number, ShowInfo>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const feed = await getFriendsFeed(user.id);
      setItems(feed);

      // Resolve nome/pôster das séries na TMDB (com cache em memória).
      const ids = [...new Set(feed.map((item) => item.tmdb_show_id))];
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const details = await getShowDetailsCached(id);
            return [id, { name: details.name, poster_path: details.poster_path }] as const;
          } catch {
            return [id, { name: `Série #${id}`, poster_path: null }] as const;
          }
        })
      );
      setShows(new Map(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o feed.');
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (items === null && !error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  function renderItem({ item }: { item: FeedItem }) {
    const show = shows.get(item.tmdb_show_id);
    const poster = posterUrl(show?.poster_path ?? null, 'w185');
    const firstEpisode =
      item.type === 'watched' ? item.episodes[item.episodes.length - 1] : item;

    return (
      <Pressable
        style={[styles.item, { backgroundColor: theme.backgroundElement }]}
        onPress={() =>
          router.push(
            `/episode/${item.tmdb_show_id}/${firstEpisode.season_number}/${firstEpisode.episode_number}`
          )
        }>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.itemBody}>
          <View style={styles.itemHeader}>
            <View style={styles.itemUser}>
              <UserAvatar
                avatarId={item.user.avatar_id}
                name={profileDisplayName(item.user)}
                size={24}
              />
              <ThemedText type="smallBold">{profileDisplayName(item.user)}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {relativeDate(item.date)}
            </ThemedText>
          </View>
          {item.type === 'watched' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {item.episodes.length === 1
                ? `assistiu ${episodeCode(
                    item.episodes[0].season_number,
                    item.episodes[0].episode_number
                  )} de `
                : `assistiu ${item.episodes.length} episódios de `}
              <ThemedText type="smallBold">{show?.name ?? '…'}</ThemedText>
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                comentou {episodeCode(item.season_number, item.episode_number)} de{' '}
                <ThemedText type="smallBold">{show?.name ?? '…'}</ThemedText>
              </ThemedText>
              {item.content ? (
                <ThemedText type="small" numberOfLines={3}>
                  “{item.content}”
                </ThemedText>
              ) : null}
              {item.image_url && (
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.commentImage}
                  contentFit="cover"
                />
              )}
            </>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, index) =>
            `${item.type}:${item.user.id}:${item.tmdb_show_id}:${item.date}:${index}`
          }
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="people" size={40} color={theme.textSecondary} />
              <ThemedText type="subtitle" style={styles.message}>
                Seu feed está vazio
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Siga amigos para ver o que eles andam assistindo e comentando.
              </ThemedText>
              <Link href="/friends" asChild>
                <Pressable style={[styles.friendsButton, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                    Encontrar amigos
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
          }
          renderItem={renderItem}
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
    marginTop: Spacing.six,
  },
  message: {
    textAlign: 'center',
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: 8,
  },
  itemBody: {
    flex: 1,
    gap: Spacing.one,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  commentImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    marginTop: Spacing.one,
  },
  friendsButton: {
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
    marginTop: Spacing.two,
  },
});
