import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { Spacing } from '@/constants/theme';
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

  function renderFeedItem({ item }: { item: FeedItem }) {
    const isMovie = item.type === 'watched_movie';
    const show = isMovie ? null : shows.get(item.tmdb_show_id);
    const poster = isMovie
      ? posterUrl(item.poster_path, 'w185')
      : posterUrl(show?.poster_path ?? null, 'w185');
    function handlePress() {
      if (item.type === 'watched_movie') {
        router.push(`/movie/${item.tmdb_id}`);
        return;
      }
      const episode = item.type === 'watched' ? item.episodes[item.episodes.length - 1] : item;
      router.push(`/episode/${item.tmdb_show_id}/${episode.season_number}/${episode.episode_number}`);
    }

    return (
      <Pressable
        style={[styles.item, { backgroundColor: theme.backgroundElement }]}
        onPress={handlePress}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.itemBody}>
          <View style={styles.itemHeader}>
            <Pressable
              hitSlop={6}
              style={styles.itemUser}
              onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.user.id } })}>
              <UserAvatar
                avatarId={item.user.avatar_id}
                name={profileDisplayName(item.user)}
                size={24}
              />
              <ThemedText type="smallBold">{profileDisplayName(item.user)}</ThemedText>
            </Pressable>
            <View style={styles.itemMeta}>
              <ThemedText type="small" themeColor="textSecondary">
                {relativeDate(item.date)}
              </ThemedText>
              {(item.type === 'watched' || item.type === 'watched_movie') && (
                <Pressable hitSlop={8} style={styles.likeButton} onPress={() => handleToggleLike(item)}>
                  <Ionicons
                    name={item.liked_by_me ? 'heart' : 'heart-outline'}
                    size={16}
                    color={item.liked_by_me ? theme.danger : theme.textSecondary}
                  />
                  {item.like_count > 0 && (
                    <ThemedText type="small" themeColor={item.liked_by_me ? 'danger' : 'textSecondary'}>
                      {item.like_count}
                    </ThemedText>
                  )}
                </Pressable>
              )}
            </View>
          </View>
          {item.type === 'watched' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {item.episodes.length === 1
                ? t('feed.watchedEpisode', {
                    code: episodeCode(
                      item.episodes[0].season_number,
                      item.episodes[0].episode_number
                    ),
                  })
                : t('feed.watchedEpisodesCount', { count: item.episodes.length })}
              <ThemedText type="smallBold">{show?.name ?? '…'}</ThemedText>
            </ThemedText>
          ) : item.type === 'watched_movie' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('feed.watchedMovie')}
              <ThemedText type="smallBold">
                {localizedTitle(item.title, item.title_en, i18n.language)}
              </ThemedText>
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t('feed.commentedEpisode', {
                  code: episodeCode(item.season_number, item.episode_number),
                })}
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
      <Pressable
        onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.user.id } })}
        style={[
          styles.rankRow,
          { backgroundColor: theme.backgroundElement },
          isMe && { borderColor: theme.accent, borderWidth: 1 },
        ]}>
        <ThemedText
          type="smallBold"
          style={[styles.rankPosition, { color: index === 0 ? theme.gold : theme.textSecondary }]}>
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
        <ThemedText type="smallBold" style={{ color: theme.gold }}>
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
            data={items}
            // Título de filme e datas usam localizedTitle()/formatDate(), que
            // dependem do idioma ativo, não do array "items" em si — sem isso
            // a lista não re-renderiza sozinha ao trocar de idioma.
            extraData={i18n.language}
            keyExtractor={(item, index) => {
              const mediaId = item.type === 'watched_movie' ? item.tmdb_id : item.tmdb_show_id;
              return `${item.type}:${item.user.id}:${mediaId}:${item.date}:${index}`;
            }}
            contentContainerStyle={[styles.list, !items.length && styles.listEmpty]}
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
    // Alinha pela base: se o coração deixa a coluna da direita mais alta que
    // o nome, o espaço extra fica em cima (imperceptível) em vez de empurrar
    // o "assistiu X" pra baixo.
    alignItems: 'flex-end',
  },
  itemUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  itemMeta: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  commentImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    marginTop: Spacing.one,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    // Altura fixa igual ao lineHeight do texto "small" (20): sem isso, a
    // linha cresce de 16 (só o ícone) pra 20 (ícone + número) ao curtir, e
    // empurra o resto do card pra baixo.
    height: 20,
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
