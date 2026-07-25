import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CommentsScreen } from '@/components/comments-screen';
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
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  getEpisodeDetails,
  getShowDetailsCached,
  stillUrl,
  type TmdbEpisode,
  type TmdbSeasonSummary,
} from '@/lib/tmdb';

export default function EpisodeScreen() {
  const theme = useTheme();
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
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [togglingWatched, setTogglingWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Evita repetir o upsert de "seguir" a cada vez que o episódio é marcado nesta tela.
  const followEnsured = useRef(false);

  useEffect(() => {
    getEpisodeDetails(showId, seasonNumber, episodeNumber)
      .then(setEpisode)
      .catch((err) => setError(errorMessage(err, 'Erro ao carregar o episódio.')));
    getShowDetailsCached(showId)
      .then((show) => {
        setShowName(show.name);
        setSeasons(show.seasons);
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
      setError(errorMessage(err, 'Não foi possível salvar a nota.'));
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
      await followShowsBulk(user.id, [
        { tmdb_id: show.id, name: show.name, poster_path: show.poster_path },
      ]);
      followEnsured.current = true;
      syncEpisodeNotifications(user.id).catch(() => {});
    } catch {
      // Seguir é efeito colateral: falhar aqui não deve desfazer o "assistido".
    }
  }, [user, showId]);

  async function toggleWatched() {
    if (!user || watched === null) return;
    const isWatched = watched;
    setTogglingWatched(true);
    setWatched(!isWatched);
    try {
      await markEpisodeWatched(user.id, showId, seasonNumber, episodeNumber, !isWatched);
      if (!isWatched) ensureFollowing();
    } catch (err) {
      setWatched(isWatched);
      setError(errorMessage(err, 'Não foi possível marcar como assistido.'));
    } finally {
      setTogglingWatched(false);
    }
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

  function goToEpisode(target: { seasonNumber: number; episodeNumber: number }) {
    router.replace({
      pathname: '/episode/[showId]/[seasonNumber]/[episodeNumber]',
      params: {
        showId: String(showId),
        seasonNumber: String(target.seasonNumber),
        episodeNumber: String(target.episodeNumber),
      },
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: code }} />
      <CommentsScreen
        mediaType="tv"
        tmdbId={showId}
        seasonNumber={seasonNumber}
        episodeNumber={episodeNumber}
        watched={watched}
        lockedText="Você ainda não marcou este episódio como assistido. Os comentários podem conter spoilers."
        header={
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
            <ThemedText type="smallBold" style={styles.title}>
              {code} — {episode.name}
            </ThemedText>
            {episode.air_date && (
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(`${episode.air_date}T00:00:00`).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
                {episode.runtime ? ` · ${episode.runtime} min` : ''}
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
                onPress={() => previousEpisode && goToEpisode(previousEpisode)}>
                <Ionicons name="play-skip-back" size={20} color={theme.text} />
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  Anterior
                </ThemedText>
              </Pressable>

              {user && watched !== null && (
                <Pressable
                  disabled={togglingWatched}
                  style={[
                    styles.watchedButton,
                    {
                      backgroundColor: watched ? theme.backgroundElement : theme.accent,
                      opacity: togglingWatched ? 0.6 : 1,
                    },
                  ]}
                  onPress={toggleWatched}>
                  <Ionicons
                    name={watched ? 'close-circle-outline' : 'checkmark-done'}
                    size={18}
                    color={watched ? theme.text : theme.accentText}
                  />
                  <ThemedText type="smallBold" style={{ color: watched ? theme.text : theme.accentText }}>
                    {watched ? 'Desmarcar como assistido' : 'Marcar como assistido'}
                  </ThemedText>
                </Pressable>
              )}

              <Pressable
                disabled={!nextEpisode}
                hitSlop={6}
                style={[
                  styles.navButton,
                  { backgroundColor: theme.backgroundElement, opacity: nextEpisode ? 1 : 0.35 },
                ]}
                onPress={() => nextEpisode && goToEpisode(nextEpisode)}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  Próximo
                </ThemedText>
                <Ionicons name="play-skip-forward" size={20} color={theme.text} />
              </Pressable>
            </View>

            <View style={[styles.ratingCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Sua nota</ThemedText>
              <StarRating value={myRating} onChange={handleRate} />
              {average && average.count > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Média da comunidade: {(average.average / 2).toFixed(1)}/5 ({average.count}{' '}
                  {average.count === 1 ? 'voto' : 'votos'})
                </ThemedText>
              )}
            </View>

            {error && <ThemedText themeColor="danger">{error}</ThemedText>}
          </View>
        }
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 12,
  },
  watchedButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingVertical: 12,
  },
});
