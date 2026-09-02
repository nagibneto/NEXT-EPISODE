import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CastList } from '@/components/cast-list';
import { Recommendations } from '@/components/recommendations';
import { ShareWatchedSheet } from '@/components/share-watched-sheet';
import { ThemedText } from '@/components/themed-text';
import { WatchProviders } from '@/components/watch-providers';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  addFavorite,
  followShow,
  getWatchedEpisodes,
  isFavorite,
  isFollowing,
  markSeasonWatched,
  onEpisodeWatchedChange,
  removeFavorite,
  unfollowShow,
  unmarkSeasonWatched,
} from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  airedEpisodesInSeason,
  backdropUrl,
  getSeasonAverageRatings,
  getSeasonDetailsCached,
  getShowDetails,
  getShowNames,
  posterUrl,
  type TmdbSeasonSummary,
  type TmdbShowDetails,
} from '@/lib/tmdb';

export default function ShowDetailsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);

  const [show, setShow] = useState<TmdbShowDetails | null>(null);
  const [seasonRatings, setSeasonRatings] = useState<Map<number, number>>(new Map());
  // season_number → episódios assistidos pelo usuário naquela temporada.
  const [watchedBySeason, setWatchedBySeason] = useState<Map<number, number>>(new Map());
  const [following, setFollowing] = useState<boolean | null>(null);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Temporada com marcação em massa em andamento (número dela, ou null).
  const [seasonBusy, setSeasonBusy] = useState<number | null>(null);
  const [shareVisible, setShareVisible] = useState(false);

  useEffect(() => {
    getShowDetails(showId)
      .then(setShow)
      .catch((err) => setError(err instanceof Error ? err.message : t('show.loadError')));
    if (user) {
      isFollowing(user.id, showId)
        .then(setFollowing)
        .catch(() => setFollowing(false));
      isFavorite(user.id, 'tv', showId)
        .then(setFavorite)
        .catch(() => setFavorite(false));
    }
  }, [showId, user]);

  // Revalida ao voltar da temporada: marcar um episódio lá passa a seguir a
  // série, e o botão "Seguindo" e as contagens por temporada precisam refletir.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      isFollowing(user.id, showId)
        .then(setFollowing)
        .catch(() => {});
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          const counts = new Map<number, number>();
          for (const episode of episodes) {
            counts.set(episode.season_number, (counts.get(episode.season_number) ?? 0) + 1);
          }
          setWatchedBySeason(counts);
        })
        .catch(() => {});
    }, [user, showId])
  );

  // Sincroniza na hora com marcações feitas em outras telas (ex.: temporada,
  // detalhes do episódio), sem esperar o próximo foco desta tela — e sem
  // correr o risco do refetch por foco acima, que pode chegar antes da
  // escrita terminar.
  useEffect(() => {
    if (!user) return;
    return onEpisodeWatchedChange((changedShowId) => {
      if (changedShowId !== showId) return;
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          const counts = new Map<number, number>();
          for (const episode of episodes) {
            counts.set(episode.season_number, (counts.get(episode.season_number) ?? 0) + 1);
          }
          setWatchedBySeason(counts);
        })
        .catch(() => {});
    });
  }, [user, showId]);

  useEffect(() => {
    if (!show) return;
    const numbers = show.seasons
      .filter((season) => season.season_number > 0)
      .map((season) => season.season_number);
    if (numbers.length === 0) return;
    let cancelled = false;
    // A nota é um extra: se a busca falhar, a tela segue funcionando sem ela.
    getSeasonAverageRatings(show.id, numbers)
      .then((ratings) => {
        if (!cancelled) setSeasonRatings(ratings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show]);

  async function toggleFollow() {
    if (!user || !show || following === null) return;
    setBusy(true);
    try {
      if (following) {
        await unfollowShow(user.id, show.id);
        setFollowing(false);
      } else {
        const names = await getShowNames(show.id);
        await followShow(user.id, {
          tmdb_id: show.id,
          ...names,
          poster_path: show.poster_path,
        });
        setFollowing(true);
      }
      syncEpisodeNotifications(user.id).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : t('show.updateError'));
    } finally {
      setBusy(false);
    }
  }

  /** Estrelinha do header: adiciona/remove dos favoritos, com desfazer se falhar. */
  async function toggleFavorite() {
    if (!user || !show || favorite === null) return;
    const next = !favorite;
    setFavorite(next);
    try {
      if (next) {
        const names = await getShowNames(show.id);
        await addFavorite(user.id, {
          media_type: 'tv',
          tmdb_id: show.id,
          title: names.name,
          title_en: names.name_en,
          poster_path: show.poster_path,
        });
      } else {
        await removeFavorite(user.id, 'tv', show.id);
      }
    } catch {
      setFavorite(!next);
    }
  }

  /** Marca todos os episódios já exibidos da temporada, ou desmarca todos. */
  async function setSeasonWatched(season: TmdbSeasonSummary, watchAll: boolean) {
    if (!user || !show) return;
    setSeasonBusy(season.season_number);
    try {
      if (watchAll) {
        // Só episódios que já foram ao ar — igual à tela da temporada.
        const details = await getSeasonDetailsCached(show.id, season.season_number);
        const today = new Date().toISOString().slice(0, 10);
        const released = details.episodes
          .filter((episode) => !!episode.air_date && episode.air_date <= today)
          .map((episode) => episode.episode_number);
        await markSeasonWatched(user.id, show.id, season.season_number, released);
        setWatchedBySeason((prev) => new Map(prev).set(season.season_number, released.length));
        // Marcar assistido também passa a seguir a série, para ela aparecer
        // na watchlist (mesmo comportamento da tela da temporada).
        if (!following) {
          const names = await getShowNames(show.id);
          await followShow(user.id, {
            tmdb_id: show.id,
            ...names,
            poster_path: show.poster_path,
          });
          setFollowing(true);
        }
        syncEpisodeNotifications(user.id).catch(() => {});
      } else {
        await unmarkSeasonWatched(user.id, show.id, season.season_number);
        setWatchedBySeason((prev) => {
          const next = new Map(prev);
          next.delete(season.season_number);
          return next;
        });
      }
    } catch (err) {
      Alert.alert(
        t('show.updateErrorTitle'),
        err instanceof Error ? err.message : t('show.tryAgain')
      );
    } finally {
      setSeasonBusy(null);
    }
  }

  /** Toque na bolinha da temporada: marca tudo, ou confirma antes de desmarcar. */
  function onSeasonCheckPress(season: TmdbSeasonSummary, complete: boolean) {
    if (complete) {
      Alert.alert(t('show.unmarkSeasonTitle'), t('show.unmarkSeasonMessage', { name: season.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('show.unmarkButton'), style: 'destructive', onPress: () => setSeasonWatched(season, false) },
      ]);
    } else {
      setSeasonWatched(season, true);
    }
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!show) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const backdrop = backdropUrl(show.backdrop_path);
  const poster = posterUrl(show.poster_path, 'w185');
  const next = show.next_episode_to_air;
  const seasons = show.seasons.filter((season) => season.season_number > 0);

  /**
   * O usuário viu tudo o que já estreou. Temporada anunciada mas ainda não
   * lançada não conta: quem terminou as 3 temporadas no ar merece as
   * indicações mesmo com a 4ª já listada no TMDB para daqui a dois meses.
   */
  const airedBySeason = seasons.map((season) => ({
    season,
    aired: airedEpisodesInSeason(show, season),
  }));
  const finished =
    airedBySeason.some(({ aired }) => aired > 0) &&
    airedBySeason.every(
      ({ season, aired }) => aired === 0 || (watchedBySeason.get(season.season_number) ?? 0) >= aired
    );

  const totalAired = airedBySeason.reduce((sum, { aired }) => sum + aired, 0);
  const totalWatched = airedBySeason.reduce(
    (sum, { season, aired }) => sum + Math.min(watchedBySeason.get(season.season_number) ?? 0, aired),
    0
  );

  return (
    <>
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: show.name }} />

        <View>
          {backdrop && (
            <Image source={{ uri: backdrop }} style={styles.backdrop} contentFit="cover" />
          )}
          {/* Estrelinha solta sobre o backdrop (o header nativo do iOS 26 põe
              um círculo de vidro em volta de qualquer botão, então ela vive
              aqui, onde controlamos o visual). */}
          <Pressable
            hitSlop={8}
            disabled={favorite === null}
            onPress={toggleFavorite}
            style={[styles.favoriteButton, !backdrop && styles.favoriteButtonInline]}>
            <MaterialCommunityIcons
              name={favorite ? 'star' : 'star-outline'}
              size={32}
              // Sem backdrop o fundo é o da tela — branco sumiria no tema claro.
              color={favorite ? theme.gold : backdrop ? '#ffffff' : theme.textSecondary}
              style={backdrop ? styles.favoriteIcon : undefined}
            />
          </Pressable>
        </View>

        <View style={styles.header}>
          {poster && <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />}
          <View style={styles.headerText}>
            <ThemedText type="smallBold" style={styles.title}>
              {show.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {show.genres.map((genre) => genre.name).join(' · ')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('show.seasonsCount', { count: show.number_of_seasons })} ·{' '}
              {show.number_of_episodes} {t('show.episodesWord')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ⭐ {show.vote_average.toFixed(1)} (TMDB)
            </ThemedText>
          </View>
        </View>

        <View style={styles.followRow}>
          <Pressable
            style={[
              styles.followButton,
              {
                backgroundColor: following ? theme.backgroundElement : theme.accent,
                opacity: busy || following === null ? 0.6 : 1,
              },
            ]}
            disabled={busy || following === null}
            onPress={toggleFollow}>
            <ThemedText
              type="smallBold"
              style={{ color: following ? theme.text : theme.accentText }}>
              {following === null ? '…' : following ? t('show.following') : t('show.follow')}
            </ThemedText>
          </Pressable>
          <Pressable
            hitSlop={8}
            style={[styles.shareIconButton, { backgroundColor: theme.backgroundElement }]}
            onPress={() => setShareVisible(true)}>
            <Ionicons name="share-social-outline" size={20} color={theme.text} />
          </Pressable>
        </View>

        {show.overview ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.overview}>
            {show.overview}
          </ThemedText>
        ) : null}

        <Recommendations media="tv" tmdbId={show.id} genres={show.genres} enabled={finished} />

        <View style={styles.topCardsRow}>
          <WatchProviders media="tv" tmdbId={show.id} style={styles.providers} />

          {next?.air_date && (
            <View style={[styles.nextEpisode, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {t('show.nextEpisode')}
              </ThemedText>
              <ThemedText type="small">
                S{String(next.season_number).padStart(2, '0')}E
                {String(next.episode_number).padStart(2, '0')}
                {next.name ? ` — ${next.name}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDate(`${next.air_date}T00:00:00`, {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                })}
              </ThemedText>
            </View>
          )}
        </View>

        <CastList media="tv" tmdbId={show.id} />

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {t('show.seasonsTitle')}
        </ThemedText>
        {seasons.map((season) => {
          const watchedCount = Math.min(
            watchedBySeason.get(season.season_number) ?? 0,
            season.episode_count
          );
          const complete = season.episode_count > 0 && watchedCount >= season.episode_count;
          return (
            <Link
              key={season.id}
              href={{
                pathname: '/show/[id]/season/[seasonNumber]',
                params: { id: String(show.id), seasonNumber: String(season.season_number) },
              }}
              asChild>
              <Pressable
                style={StyleSheet.flatten([styles.seasonRow, { backgroundColor: theme.backgroundElement }])}>
                <View style={styles.seasonText}>
                  <ThemedText type="smallBold">{season.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {following || watchedBySeason.has(season.season_number)
                      ? `${watchedCount}/`
                      : ''}
                    {season.episode_count} {t('show.episodesWord')}
                    {season.air_date ? ` · ${season.air_date.slice(0, 4)}` : ''}
                  </ThemedText>
                </View>
                {seasonRatings.has(season.season_number) && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.seasonRating}>
                    ⭐ {seasonRatings.get(season.season_number)!.toFixed(1)}
                  </ThemedText>
                )}
                <Pressable
                  hitSlop={8}
                  style={styles.seasonCheck}
                  disabled={seasonBusy !== null}
                  onPress={() => onSeasonCheckPress(season, complete)}>
                  {seasonBusy === season.season_number ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons
                      name={complete ? 'checkmark-circle' : 'ellipse-outline'}
                      size={26}
                      color={complete ? theme.accent : theme.textSecondary}
                    />
                  )}
                </Pressable>
                <ThemedText themeColor="textSecondary">›</ThemedText>
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
      <ShareWatchedSheet
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        imageUrl={backdrop ?? poster}
        badgeLabel={t('shareWatchedSheet.followingBadge')}
        title={show.name}
        subtitle={totalAired > 0 ? `${totalWatched}/${totalAired} ${t('show.episodesWord')}` : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.six,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  favoriteButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
  },
  // Sem backdrop não há imagem para ancorar: a estrela vira uma linha normal
  // alinhada à direita.
  favoriteButtonInline: {
    position: 'relative',
    top: 0,
    right: 0,
    alignSelf: 'flex-end',
    margin: Spacing.two,
  },
  // Sombra para a estrela não sumir em backdrops claros.
  favoriteIcon: {
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 6,
  },
  backdrop: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  header: {
    flexDirection: 'row',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  poster: {
    width: 92,
    height: 138,
    borderRadius: 8,
    marginTop: -Spacing.five,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  followRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
  },
  followButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareIconButton: {
    width: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topCardsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  providers: {
    flex: 1,
  },
  nextEpisode: {
    flex: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  overview: {
    padding: Spacing.three,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.three,
    // Respiro do card acima (o elenco pode não existir, e aí "Temporadas"
    // encostaria no "Assista em").
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    fontSize: 18,
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  seasonText: {
    flex: 1,
    gap: Spacing.half,
  },
  seasonRating: {
    marginRight: Spacing.two,
  },
  seasonCheck: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.one,
  },
});
