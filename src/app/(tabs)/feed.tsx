import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
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
import {
  getFriends,
  getFriendsEpisodeCounts,
  getFriendsFeed,
  getFriendsMovieWatches,
  getProfile,
  profileDisplayName,
  type FeedItem,
  type Profile,
} from '@/lib/db';
import {
  episodeRuntime,
  FALLBACK_MOVIE_RUNTIME_MIN,
  FALLBACK_RUNTIME_MIN,
  getMovieDetailsCached,
  getShowDetailsCached,
  posterUrl,
} from '@/lib/tmdb';

interface ShowInfo {
  name: string;
  poster_path: string | null;
}

type FeedView = 'feed' | 'ranking';
type Period = 'week' | 'month' | 'all';

interface RankingEntry {
  user: Profile;
  minutes: number;
  episodes: number;
  movies: number;
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

/** Versão curta ("3d 14h", "5h 20min", "42 min"), igual à usada em Estatísticas. */
function shortDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes} min`;
}

function periodSince(period: Period): Date | null {
  if (period === 'all') return null;
  const days = period === 'week' ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000);
}

export default function FeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<FeedView>('feed');
  const [period, setPeriod] = useState<Period>('week');
  const [refreshing, setRefreshing] = useState(false);

  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [shows, setShows] = useState<Map<number, ShowInfo>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  const [rankingError, setRankingError] = useState<string | null>(null);

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

  const loadRanking = useCallback(async () => {
    if (!user) return;
    try {
      setRankingError(null);
      setRanking(null);
      const [me, friends] = await Promise.all([getProfile(user.id), getFriends(user.id)]);
      const people = [me, ...friends].filter((p): p is Profile => p !== null);
      const ids = people.map((p) => p.id);
      const since = periodSince(period);

      const [episodeCounts, movieWatches] = await Promise.all([
        getFriendsEpisodeCounts(ids, since),
        getFriendsMovieWatches(ids, since),
      ]);

      // Duração típica por série/filme, resolvida na TMDB (mesmo cache em memória de Estatísticas).
      const showIds = [...new Set(episodeCounts.map((c) => c.tmdb_show_id))];
      const showRuntimes = new Map(
        await Promise.all(
          showIds.map(async (id) => {
            try {
              return [id, episodeRuntime(await getShowDetailsCached(id))] as const;
            } catch {
              return [id, FALLBACK_RUNTIME_MIN] as const;
            }
          })
        )
      );
      const movieIds = [...new Set(movieWatches.map((m) => m.tmdb_id))];
      const movieRuntimes = new Map(
        await Promise.all(
          movieIds.map(async (id) => {
            try {
              const details = await getMovieDetailsCached(id);
              return [id, details.runtime || FALLBACK_MOVIE_RUNTIME_MIN] as const;
            } catch {
              return [id, FALLBACK_MOVIE_RUNTIME_MIN] as const;
            }
          })
        )
      );

      const totals = new Map(ids.map((id) => [id, { minutes: 0, episodes: 0, movies: 0 }]));
      for (const count of episodeCounts) {
        const entry = totals.get(count.user_id);
        if (!entry) continue;
        const runtime = showRuntimes.get(count.tmdb_show_id) ?? FALLBACK_RUNTIME_MIN;
        entry.minutes += count.episode_count * runtime;
        entry.episodes += count.episode_count;
      }
      for (const watch of movieWatches) {
        const entry = totals.get(watch.user_id);
        if (!entry) continue;
        entry.minutes += movieRuntimes.get(watch.tmdb_id) ?? FALLBACK_MOVIE_RUNTIME_MIN;
        entry.movies += 1;
      }

      const result = people
        .map((person) => ({ user: person, ...totals.get(person.id)! }))
        .sort((a, b) => b.minutes - a.minutes);
      setRanking(result);
    } catch (err) {
      setRankingError(err instanceof Error ? err.message : 'Erro ao carregar o ranking.');
    }
  }, [user, period]);

  useFocusEffect(
    useCallback(() => {
      if (view === 'feed') load();
      else loadRanking();
    }, [view, load, loadRanking])
  );

  async function handleRefresh() {
    setRefreshing(true);
    if (view === 'feed') await load();
    else await loadRanking();
    setRefreshing(false);
  }

  function renderFeedItem({ item }: { item: FeedItem }) {
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

  function renderRankingItem({ item, index }: { item: RankingEntry; index: number }) {
    const isMe = item.user.id === user?.id;
    return (
      <View
        style={[
          styles.rankRow,
          { backgroundColor: theme.backgroundElement },
          isMe && { borderColor: theme.accent, borderWidth: 1 },
        ]}>
        <ThemedText
          type="smallBold"
          style={[styles.rankPosition, { color: index === 0 ? theme.gold : theme.textSecondary }]}>
          {index + 1}º
        </ThemedText>
        <UserAvatar avatarId={item.user.avatar_id} name={profileDisplayName(item.user)} size={36} />
        <View style={styles.rankInfo}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {profileDisplayName(item.user)}
            {isMe ? ' (você)' : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {item.episodes.toLocaleString('pt-BR')}{' '}
            {item.episodes === 1 ? 'episódio' : 'episódios'}
            {item.movies > 0
              ? ` · ${item.movies.toLocaleString('pt-BR')} ${item.movies === 1 ? 'filme' : 'filmes'}`
              : ''}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.gold }}>
          {shortDuration(item.minutes)}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
        {(
          [
            { value: 'feed', label: 'Feed', icon: 'newspaper-outline' },
            { value: 'ranking', label: 'Ranking', icon: 'trophy' },
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

      {view === 'ranking' && (
        <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
          {(
            [
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mês' },
              { value: 'all', label: 'Sempre' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              style={[styles.segment, period === option.value && { backgroundColor: theme.accent }]}
              onPress={() => setPeriod(option.value)}>
              <ThemedText
                type="small"
                numberOfLines={1}
                style={[
                  styles.segmentText,
                  { color: period === option.value ? theme.accentText : theme.textSecondary },
                ]}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {view === 'feed' ? (
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
            keyExtractor={(item, index) =>
              `${item.type}:${item.user.id}:${item.tmdb_show_id}:${item.date}:${index}`
            }
            contentContainerStyle={[styles.list, !items.length && styles.listEmpty]}
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
                <Pressable
                  style={[styles.friendsButton, { backgroundColor: theme.accent }]}
                  onPress={() => router.push('/friends')}>
                  <Ionicons name="person-add" size={18} color={theme.accentText} />
                  <ThemedText
                    type="smallBold"
                    style={[styles.friendsButtonLabel, { color: theme.accentText }]}>
                    Encontrar amigos
                  </ThemedText>
                </Pressable>
              </View>
            }
            renderItem={renderFeedItem}
          />
        )
      ) : rankingError ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {rankingError}
          </ThemedText>
        </View>
      ) : ranking === null ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={ranking}
          keyExtractor={(item) => item.user.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={renderRankingItem}
          ListFooterComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Tempo estimado com base na duração dos episódios e filmes informada pela TMDB.
            </ThemedText>
          }
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
    padding: Spacing.three,
    gap: Spacing.two,
  },
  // Faz o estado vazio ocupar a tela toda para o botão ficar no centro.
  listEmpty: {
    flexGrow: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.five,
    paddingVertical: 14,
    marginTop: Spacing.three,
    elevation: 2,
  },
  friendsButtonLabel: {
    fontSize: 16,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  rankPosition: {
    width: 28,
    textAlign: 'center',
  },
  rankInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  note: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
