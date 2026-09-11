import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  getFriends,
  getFriendsEpisodeCounts,
  getFriendsFeed,
  getFriendsMovieWatches,
  getProfile,
  likeFeedActivity,
  profileDisplayName,
  unlikeFeedActivity,
  type FeedItem,
  type FeedWatchedItem,
  type FeedWatchedMovieItem,
  type Profile,
} from '@/lib/db';
import { shortDuration } from '@/lib/duration';
import { i18n } from '@/lib/i18n';
import { localizedTitle } from '@/lib/locale';
import { relativeDate } from '@/lib/relative-date';
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

function periodSince(period: Period): Date | null {
  if (period === 'all') return null;
  const days = period === 'week' ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * Atividades do mesmo tipo, do mesmo usuário e no mesmo dia viram um card só
 * ("Bia · assistiu a 3 filmes"), com uma linha por título dentro.
 */
interface FeedGroup {
  key: string;
  user: Profile;
  type: FeedItem['type'];
  /** Data da atividade mais recente do grupo (a lista já vem em ordem decrescente). */
  date: string;
  items: FeedItem[];
}

function groupFeedItems(items: FeedItem[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  const byKey = new Map<string, FeedGroup>();
  for (const item of items) {
    const key = `${item.type}:${item.user.id}:${item.date.slice(0, 10)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    // A ordem de criação segue a da lista (decrescente por data), então o
    // primeiro item de cada grupo já é o mais recente dele.
    const group: FeedGroup = { key, user: item.user, type: item.type, date: item.date, items: [item] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

export default function FeedScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
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

      // Resolve nome/pôster das séries na TMDB (com cache em memória). Filmes
      // já trazem título/pôster de watched_movies, sem precisar da TMDB.
      const showIds = feed
        .filter((item): item is Exclude<FeedItem, FeedWatchedMovieItem> => item.type !== 'watched_movie')
        .map((item) => item.tmdb_show_id);
      const ids = [...new Set(showIds)];
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const details = await getShowDetailsCached(id);
            return [id, { name: details.name, poster_path: details.poster_path }] as const;
          } catch {
            return [id, { name: t('feed.unknownShowName', { id }), poster_path: null }] as const;
          }
        })
      );
      setShows(new Map(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('feed.loadFeedError'));
    }
  }, [user, t]);

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
      setRankingError(err instanceof Error ? err.message : t('feed.loadRankingError'));
    }
  }, [user, period, t]);

  useFocusEffect(
    useCallback(() => {
      if (view === 'feed') load();
      else loadRanking();
    }, [view, load, loadRanking])
  );

  const groups = useMemo(() => groupFeedItems(items ?? []), [items]);

  async function handleRefresh() {
    setRefreshing(true);
    if (view === 'feed') await load();
    else await loadRanking();
    setRefreshing(false);
  }

  async function handleToggleLike(target: FeedWatchedItem | FeedWatchedMovieItem) {
    if (!user) return;
    setItems((prev) =>
      (prev ?? []).map((it) =>
        it === target
          ? { ...it, liked_by_me: !it.liked_by_me, like_count: it.like_count + (it.liked_by_me ? -1 : 1) }
          : it
      )
    );
    try {
      if (target.liked_by_me) await unlikeFeedActivity(user.id, target);
      else await likeFeedActivity(user.id, target);
    } catch {
      await load(); // reverte buscando o feed de novo em caso de erro
    }
  }

  /** Resumo do card: "assistiu a 3 filmes", "comentou 2 episódios"… */
  function groupSummary(group: FeedGroup): string {
    const count = group.items.length;
    if (group.type === 'watched_movie') return t('feed.groupMovies', { count });
    if (group.type === 'comment') return t('feed.groupComments', { count });
    // Séries: o número relevante é o de episódios, não o de séries diferentes.
    const episodes = group.items.reduce(
      (total, item) => total + (item.type === 'watched' ? item.episodes.length : 0),
      0
    );
    return count === 1
      ? t('feed.groupEpisodes', { count: episodes })
      : t('feed.groupEpisodesShows', { count: episodes, shows: count });
  }

  /** Uma linha dentro do card: pôster, título, detalhe e o coração de curtir. */
  function renderGroupRow(item: FeedItem, index: number) {
    const isMovie = item.type === 'watched_movie';
    const show = isMovie ? null : shows.get(item.tmdb_show_id);
    const poster = isMovie
      ? posterUrl(item.poster_path, 'w185')
      : posterUrl(show?.poster_path ?? null, 'w185');
    const title = isMovie
      ? localizedTitle(item.title, item.title_en, i18n.language)
      : (show?.name ?? '…');

    function handlePress() {
      if (item.type === 'watched_movie') {
        router.push(`/movie/${item.tmdb_id}`);
        return;
      }
      const episode = item.type === 'watched' ? item.episodes[item.episodes.length - 1] : item;
      router.push(`/episode/${item.tmdb_show_id}/${episode.season_number}/${episode.episode_number}`);
    }

    let detail: string;
    if (item.type === 'watched_movie') {
      detail = t('feed.rowMovie');
    } else if (item.type === 'watched') {
      detail =
        item.episodes.length === 1
          ? episodeCode(item.episodes[0].season_number, item.episodes[0].episode_number)
          : t('feed.rowEpisodes', { count: item.episodes.length });
    } else {
      detail = episodeCode(item.season_number, item.episode_number);
    }

    return (
      <Pressable
        key={`${item.type}:${isMovie ? item.tmdb_id : item.tmdb_show_id}:${index}`}
        style={[
          styles.groupRow,
          index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.backgroundSelected },
        ]}
        onPress={handlePress}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.groupRowBody}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {detail}
          </ThemedText>
          {item.type === 'comment' && item.content ? (
            <ThemedText type="small" numberOfLines={3}>
              “{item.content}”
            </ThemedText>
          ) : null}
          {item.type === 'comment' && item.image_url ? (
            <Image
              source={{ uri: item.image_url }}
              style={styles.commentImage}
              contentFit="cover"
            />
          ) : null}
        </View>
        {(item.type === 'watched' || item.type === 'watched_movie') && (
          <Pressable hitSlop={8} style={styles.likeButton} onPress={() => handleToggleLike(item)}>
            <Ionicons
              name={item.liked_by_me ? 'heart' : 'heart-outline'}
              size={18}
              color={item.liked_by_me ? theme.danger : theme.textSecondary}
            />
            {item.like_count > 0 && (
              <ThemedText type="small" themeColor={item.liked_by_me ? 'danger' : 'textSecondary'}>
                {item.like_count}
              </ThemedText>
            )}
          </Pressable>
        )}
      </Pressable>
    );
  }

  function renderFeedGroup({ item: group }: { item: FeedGroup }) {
    return (
      <View style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.groupHeader}>
          <Pressable
            hitSlop={6}
            style={styles.itemUser}
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: group.user.id } })}>
            <UserAvatar
              avatarId={group.user.avatar_id}
              name={profileDisplayName(group.user)}
              size={32}
            />
            <View style={styles.groupHeaderText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {profileDisplayName(group.user)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {groupSummary(group)}
              </ThemedText>
            </View>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            {relativeDate(group.date)}
          </ThemedText>
        </View>
        {group.items.map(renderGroupRow)}
      </View>
    );
  }

  function renderRankingItem({ item, index }: { item: RankingEntry; index: number }) {
    const isMe = item.user.id === user?.id;
    return (
      <Pressable
        onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.user.id } })}
        style={[
          styles.rankRow,
          { backgroundColor: theme.backgroundElement },
          isMe && { borderColor: theme.accent, borderWidth: 1 },
        ]}>
        <ThemedText
          type="smallBold"
          style={[styles.rankPosition, { color: index === 0 ? theme.goldText : theme.textSecondary }]}>
          {index + 1}
          {t('feed.rankSuffix')}
        </ThemedText>
        <UserAvatar avatarId={item.user.avatar_id} name={profileDisplayName(item.user)} size={36} />
        <View style={styles.rankInfo}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {profileDisplayName(item.user)}
            {isMe ? t('feed.youSuffix') : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {t('feed.episodeCount', {
              count: item.episodes,
              formatted: item.episodes.toLocaleString(i18n.language),
            })}
            {item.movies > 0
              ? t('feed.movieCount', {
                  count: item.movies,
                  formatted: item.movies.toLocaleString(i18n.language),
                })
              : ''}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.goldText }}>
          {shortDuration(item.minutes)}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
        {(
          [
            { value: 'feed', label: t('feed.feedTab'), icon: 'newspaper-outline' },
            { value: 'ranking', label: t('feed.rankingTab'), icon: 'trophy' },
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
              { value: 'week', label: t('feed.weekPeriod') },
              { value: 'month', label: t('feed.monthPeriod') },
              { value: 'all', label: t('feed.allPeriod') },
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
            data={groups}
            // Título de filme e datas usam localizedTitle()/formatDate(), que
            // dependem do idioma ativo, não do array "items" em si — sem isso
            // a lista não re-renderiza sozinha ao trocar de idioma.
            extraData={i18n.language}
            keyExtractor={(group) => group.key}
            contentContainerStyle={[styles.list, !groups.length && styles.listEmpty]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="people" size={40} color={theme.textSecondary} />
                <ThemedText type="subtitle" style={styles.message}>
                  {t('feed.emptyFeedTitle')}
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.message}>
                  {t('feed.emptyFeedBody')}
                </ThemedText>
                <Pressable
                  style={[styles.friendsButton, { backgroundColor: theme.accent }]}
                  onPress={() => router.push('/friends')}>
                  <Ionicons name="person-add" size={18} color={theme.accentText} />
                  <ThemedText
                    type="smallBold"
                    style={[styles.friendsButtonLabel, { color: theme.accentText }]}>
                    {t('feed.findFriends')}
                  </ThemedText>
                </Pressable>
              </View>
            }
            renderItem={renderFeedGroup}
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
          extraData={i18n.language}
          keyExtractor={(item) => item.user.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={renderRankingItem}
          ListFooterComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              {t('feed.rankingNote')}
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
  // Card de um grupo: cabeçalho (quem + resumo + quando) e uma linha por título.
  item: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  groupHeaderText: {
    flexShrink: 1,
    gap: 1,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  groupRowBody: {
    flex: 1,
    gap: Spacing.half,
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: Radius.sm,
  },
  itemUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  commentImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radius.sm,
    marginTop: Spacing.one,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    // Largura fixa: sem isso a linha "pula" pro lado quando o contador
    // aparece/some ao curtir.
    minWidth: 34,
    justifyContent: 'flex-end',
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
