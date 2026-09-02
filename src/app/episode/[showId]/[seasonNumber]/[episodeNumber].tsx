import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { CommentsScreen } from '@/components/comments-screen';
import { ShareWatchedSheet } from '@/components/share-watched-sheet';
import { SkippedEpisodesSheet } from '@/components/skipped-episodes-sheet';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  followShowsBulk,
  getEpisodeAverageRating,
  getMyEpisodeRating,
  isEpisodeWatched,
  markEpisodeWatched,
  rateEpisode,
} from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  getSkippedEpisodes,
  markSkippedEpisodesWatched,
  type SkippedEpisode,
} from '@/lib/watch-next';
import {
  getEpisodeDetails,
  getShowDetailsCached,
  getShowNames,
  isLatestAiredEpisode,
  stillUrl,
  type TmdbEpisode,
  type TmdbSeasonSummary,
} from '@/lib/tmdb';

export default function EpisodeScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    showId: string;
    seasonNumber: string;
    episodeNumber: string;
  }>();
  const showId = Number(params.showId);
  const seasonNumber = Number(params.seasonNumber);
  const episodeNumber = Number(params.episodeNumber);

  const [episode, setEpisode] = useState<TmdbEpisode | null>(null);
  const [showName, setShowName] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<TmdbSeasonSummary[] | null>(null);
  const [lastEpisodeToAir, setLastEpisodeToAir] = useState<TmdbEpisode | null>(null);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [togglingWatched, setTogglingWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedPrompt, setSkippedPrompt] = useState<SkippedEpisode[] | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  // Evita repetir o upsert de "seguir" a cada vez que o episódio é marcado nesta tela.
  const followEnsured = useRef(false);

  useEffect(() => {
    // Reseta ao trocar de episódio (Anterior/Próximo, arrastar): sem isso a
    // tela ficaria mostrando o estado "assistido" do episódio antigo até a
    // busca do novo terminar, arriscando marcar o episódio errado se o
    // usuário tocar no botão nesse intervalo.
    setEpisode(null);
    setWatched(null);
    setMyRating(null);
    setAverage(null);
    setError(null);
    getEpisodeDetails(showId, seasonNumber, episodeNumber)
      .then(setEpisode)
      .catch((err) => setError(errorMessage(err, t('episode.loadError'))));
    getShowDetailsCached(showId)
      .then((show) => {
        setShowName(show.name);
        setSeasons(show.seasons);
        setLastEpisodeToAir(show.last_episode_to_air);
      })
      .catch(() => {});
    getEpisodeAverageRating(showId, seasonNumber, episodeNumber)
      .then(setAverage)
      .catch(() => {});
    if (user) {
      getMyEpisodeRating(user.id, showId, seasonNumber, episodeNumber)
        .then(setMyRating)
        .catch(() => {});
      isEpisodeWatched(user.id, showId, seasonNumber, episodeNumber)
        .then(setWatched)
        .catch(() => setWatched(false));
    }
  }, [showId, seasonNumber, episodeNumber, user]);

  async function handleRate(rating: number) {
    if (!user) return;
    setMyRating(rating);
    try {
      await rateEpisode(user.id, showId, seasonNumber, episodeNumber, rating);
      const avg = await getEpisodeAverageRating(showId, seasonNumber, episodeNumber);
      setAverage(avg);
    } catch (err) {
      setError(errorMessage(err, t('episode.rateError')));
    }
  }

  /**
   * Marcar o episódio como assistido também passa a seguir a série, para ela
   * aparecer na watchlist. O upsert ignora duplicados, então é seguro chamar
   * mesmo que o usuário já siga.
   */
  const ensureFollowing = useCallback(async () => {
    if (!user || followEnsured.current) return;
    try {
      const show = await getShowDetailsCached(showId);
      const names = await getShowNames(show.id);
      await followShowsBulk(user.id, [{ tmdb_id: show.id, ...names, poster_path: show.poster_path }]);
      followEnsured.current = true;
      syncEpisodeNotifications(user.id).catch(() => {});
    } catch {
      // Seguir é efeito colateral: falhar aqui não deve desfazer o "assistido".
    }
  }, [user, showId]);

  /**
   * Efetiva a marcação: o episódio atual e, se o usuário confirmou no aviso
   * de episódios pulados, os episódios anteriores deixados como não vistos.
   */
  async function commitWatched(userId: string, nextWatched: boolean, extraSkipped: SkippedEpisode[] = []) {
    setTogglingWatched(true);
    setWatched(nextWatched);
    try {
      await markEpisodeWatched(userId, showId, seasonNumber, episodeNumber, nextWatched);
      if (nextWatched) {
        ensureFollowing();
        const isLastOfSeason = !!currentSeason && episodeNumber === currentSeason.episode_count;
        if (isLastOfSeason || isLatestAiredEpisode(lastEpisodeToAir, seasonNumber, episodeNumber)) {
          setShareVisible(true);
        }
      }
      if (extraSkipped.length > 0) {
        await markSkippedEpisodesWatched(userId, showId, extraSkipped);
      }
    } catch (err) {
      setWatched(!nextWatched);
      setError(errorMessage(err, t('episode.watchToggleError')));
    } finally {
      setTogglingWatched(false);
    }
  }

  async function toggleWatched() {
    if (!user || watched === null) return;
    const userId = user.id;
    const isWatched = watched;

    if (isWatched) {
      commitWatched(userId, false);
      return;
    }

    // Marcando como assistido: avisa se ficaram episódios anteriores pulados.
    setTogglingWatched(true);
    const skipped = await getSkippedEpisodes(userId, showId, seasonNumber, episodeNumber).catch(
      () => []
    );
    setTogglingWatched(false);

    if (skipped.length > 0) {
      setSkippedPrompt(skipped);
      return;
    }

    commitWatched(userId, true);
  }

  if (error && !episode) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!episode) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const still = stillUrl(episode.still_path, 'original');
  const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;

  const currentSeason = seasons?.find((s) => s.season_number === seasonNumber);
  const previousEpisode =
    episodeNumber > 1
      ? { seasonNumber, episodeNumber: episodeNumber - 1 }
      : (() => {
          const previousSeason = seasons?.find((s) => s.season_number === seasonNumber - 1 && s.season_number > 0);
          return previousSeason && previousSeason.episode_count > 0
            ? { seasonNumber: previousSeason.season_number, episodeNumber: previousSeason.episode_count }
            : null;
        })();
  const nextEpisode =
    currentSeason && episodeNumber < currentSeason.episode_count
      ? { seasonNumber, episodeNumber: episodeNumber + 1 }
      : (() => {
          const nextSeason = seasons?.find((s) => s.season_number === seasonNumber + 1);
          return nextSeason && nextSeason.episode_count > 0
            ? { seasonNumber: nextSeason.season_number, episodeNumber: 1 }
            : null;
        })();

  function goToEpisode(
    target: { seasonNumber: number; episodeNumber: number },
    direction: 'prev' | 'next'
  ) {
    router.replace({
      pathname: '/episode/[showId]/[seasonNumber]/[episodeNumber]',
      params: {
        showId: String(showId),
        seasonNumber: String(target.seasonNumber),
        episodeNumber: String(target.episodeNumber),
        // Lido só pelo _layout.tsx raiz para escolher o lado da animação.
        direction,
      },
    });
  }

  // Só ativa em arrastos predominantemente horizontais, para não competir
  // com o scroll vertical da lista de comentários.
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((event) => {
      const fastFling = Math.abs(event.velocityX) > 800 && Math.abs(event.translationX) > 20;
      if (!fastFling && Math.abs(event.translationX) < 70) return;
      if (event.translationX < 0 && nextEpisode) {
        runOnJS(goToEpisode)(nextEpisode, 'next');
      } else if (event.translationX > 0 && previousEpisode) {
        runOnJS(goToEpisode)(previousEpisode, 'prev');
      }
    });

  return (
    <>
      <Stack.Screen options={{ title: code }} />
      <CommentsScreen
        mediaType="tv"
        tmdbId={showId}
        seasonNumber={seasonNumber}
        episodeNumber={episodeNumber}
        watched={watched}
        lockedText={t('episode.commentsLocked')}
        header={
          <GestureDetector gesture={swipeGesture}>
            <View style={styles.header}>
              {showName && (
                <Link href={{ pathname: '/show/[id]', params: { id: String(showId) } }} asChild>
                  <Pressable style={styles.showLink} hitSlop={6}>
                    <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.accent }}>
                      {showName}
                    </ThemedText>
                    <Ionicons name="chevron-forward" size={12} color={theme.accent} />
                  </Pressable>
                </Link>
              )}
              {still && <Image source={{ uri: still }} style={styles.still} contentFit="cover" />}
              <View style={styles.titleRow}>
                <ThemedText type="smallBold" style={[styles.title, styles.titleText]}>
                  {code} — {episode.name}
                </ThemedText>
                {user && watched !== null && (
                  <Pressable
                    hitSlop={8}
                    disabled={togglingWatched}
                    onPress={toggleWatched}
                    style={{ opacity: togglingWatched ? 0.6 : 1 }}>
                    <Ionicons
                      name={watched ? 'checkmark-circle' : 'ellipse-outline'}
                      size={28}
                      color={watched ? theme.accent : theme.textSecondary}
                    />
                  </Pressable>
                )}
              </View>
              {episode.air_date && (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDate(`${episode.air_date}T00:00:00`, {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                  {episode.runtime ? ` · ${episode.runtime} ${t('episode.minutesSuffix')}` : ''}
                </ThemedText>
              )}
              {episode.overview ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {episode.overview}
                </ThemedText>
              ) : null}

              <View style={styles.navRow}>
                <Pressable
                  disabled={!previousEpisode}
                  hitSlop={6}
                  style={[
                    styles.navButton,
                    { backgroundColor: theme.backgroundElement, opacity: previousEpisode ? 1 : 0.35 },
                  ]}
                  onPress={() => previousEpisode && goToEpisode(previousEpisode, 'prev')}>
                  <Ionicons name="play-skip-back" size={20} color={theme.text} />
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.text }}>
                    {t('episode.previousEpisode')}
                  </ThemedText>
                </Pressable>

                <Pressable
                  disabled={!nextEpisode}
                  hitSlop={6}
                  style={[
                    styles.navButton,
                    { backgroundColor: theme.backgroundElement, opacity: nextEpisode ? 1 : 0.35 },
                  ]}
                  onPress={() => nextEpisode && goToEpisode(nextEpisode, 'next')}>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.text }}>
                    {t('episode.nextEpisode')}
                  </ThemedText>
                  <Ionicons name="play-skip-forward" size={20} color={theme.text} />
                </Pressable>
              </View>

              <View style={[styles.ratingCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">{t('episode.yourRating')}</ThemedText>
                <StarRating value={myRating} onChange={handleRate} />
                {average && average.count > 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('episode.communityAverage', {
                      rating: (average.average / 2).toFixed(1),
                      count: average.count,
                    })}
                  </ThemedText>
                )}
              </View>

              {error && <ThemedText themeColor="danger">{error}</ThemedText>}
            </View>
          </GestureDetector>
        }
      />
      <SkippedEpisodesSheet
        visible={skippedPrompt !== null}
        count={skippedPrompt?.length ?? 0}
        onClose={() => setSkippedPrompt(null)}
        onSkip={() => {
          if (user) commitWatched(user.id, true);
        }}
        onMarkAll={() => {
          if (user && skippedPrompt) commitWatched(user.id, true, skippedPrompt);
        }}
      />
      <ShareWatchedSheet
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        imageUrl={still}
        badgeLabel={t('shareWatchedSheet.episodeBadge')}
        title={showName ?? episode.name}
        subtitle={`${code} — ${episode.name}`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  header: {
    gap: Spacing.two,
  },
  showLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
  },
  still: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleText: {
    flex: 1,
  },
  ratingCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingVertical: 12,
  },
});
