import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CastList } from '@/components/cast-list';
import { CommentsScreen } from '@/components/comments-screen';
import { Recommendations } from '@/components/recommendations';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { WatchProviders } from '@/components/watch-providers';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  addFavorite,
  addMovieToWatchlist,
  errorMessage,
  getEpisodeAverageRating,
  getMyEpisodeRating,
  isFavorite,
  isMovieInWatchlist,
  isMovieWatched,
  markMovieWatched,
  rateEpisode,
  removeFavorite,
  removeMovieFromWatchlist,
} from '@/lib/db';
import {
  backdropUrl,
  getMovieDetails,
  getMovieNames,
  posterUrl,
  type TmdbMovieDetails,
} from '@/lib/tmdb';

export default function MovieDetailsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);

  const [movie, setMovie] = useState<TmdbMovieDetails | null>(null);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMovieDetails(movieId)
      .then(setMovie)
      .catch((err) => setError(errorMessage(err, t('movie.loadError'))));
    getEpisodeAverageRating(movieId, 0, 0, 'movie')
      .then(setAverage)
      .catch(() => {});
    if (user) {
      isMovieWatched(user.id, movieId)
        .then(setWatched)
        .catch(() => setWatched(false));
      isFavorite(user.id, 'movie', movieId)
        .then(setFavorite)
        .catch(() => setFavorite(false));
      isMovieInWatchlist(user.id, movieId)
        .then(setInWatchlist)
        .catch(() => setInWatchlist(false));
      getMyEpisodeRating(user.id, movieId, 0, 0, 'movie')
        .then(setMyRating)
        .catch(() => {});
    }
  }, [movieId, user]);

  async function toggleWatched() {
    if (!user || !movie || watched === null) return;
    setBusy(true);
    try {
      const names = await getMovieNames(movie.id);
      await markMovieWatched(
        user.id,
        { tmdb_id: movie.id, ...names, poster_path: movie.poster_path },
        !watched
      );
      setWatched(!watched);
      // Marcar como assistido também tira o filme do "Para assistir".
      if (!watched) setInWatchlist(false);
    } catch (err) {
      setError(errorMessage(err, t('movie.updateError')));
    } finally {
      setBusy(false);
    }
  }

  /** Botão "Para assistir": entra/sai da watchlist de filmes. */
  async function toggleWatchlist() {
    if (!user || !movie || inWatchlist === null) return;
    const next = !inWatchlist;
    setInWatchlist(next);
    try {
      if (next) {
        const names = await getMovieNames(movie.id);
        await addMovieToWatchlist(user.id, {
          tmdb_id: movie.id,
          ...names,
          poster_path: movie.poster_path,
        });
      } else {
        await removeMovieFromWatchlist(user.id, movie.id);
      }
    } catch (err) {
      setInWatchlist(!next);
      setError(errorMessage(err, t('movie.updateError')));
    }
  }

  /** Estrelinha do header: adiciona/remove dos favoritos, com desfazer se falhar. */
  async function toggleFavorite() {
    if (!user || !movie || favorite === null) return;
    const next = !favorite;
    setFavorite(next);
    try {
      if (next) {
        const names = await getMovieNames(movie.id);
        await addFavorite(user.id, {
          media_type: 'movie',
          tmdb_id: movie.id,
          title: names.title,
          title_en: names.title_en,
          poster_path: movie.poster_path,
        });
      } else {
        await removeFavorite(user.id, 'movie', movie.id);
      }
    } catch {
      setFavorite(!next);
    }
  }

  async function handleRate(rating: number) {
    if (!user) return;
    setMyRating(rating);
    try {
      await rateEpisode(user.id, movieId, 0, 0, rating, 'movie');
      const avg = await getEpisodeAverageRating(movieId, 0, 0, 'movie');
      setAverage(avg);
    } catch (err) {
      setError(errorMessage(err, t('movie.rateError')));
    }
  }

  if (error && !movie) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!movie) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const backdrop = backdropUrl(movie.backdrop_path);
  const poster = posterUrl(movie.poster_path, 'w185');
  const year = movie.release_date ? movie.release_date.slice(0, 4) : null;

  return (
    <>
      <Stack.Screen options={{ title: movie.title }} />
      <CommentsScreen
        mediaType="movie"
        tmdbId={movieId}
        watched={watched}
        lockedText={t('movie.commentsLocked')}
        header={
          <View style={styles.header}>
            <View>
              {backdrop && (
                <Image source={{ uri: backdrop }} style={styles.backdrop} contentFit="cover" />
              )}
              {/* Estrelinha solta sobre o backdrop (o header nativo do iOS 26
                  põe um círculo de vidro em volta de qualquer botão, então ela
                  vive aqui, onde controlamos o visual). */}
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
            <View style={styles.headerRow}>
              {poster && <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />}
              <View style={styles.headerText}>
                <ThemedText type="smallBold" style={styles.title}>
                  {movie.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {movie.genres.map((genre) => genre.name).join(' · ')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {[year, movie.runtime ? `${movie.runtime} ${t('movie.minutesSuffix')}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ⭐ {movie.vote_average.toFixed(1)} (TMDB)
                </ThemedText>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={[
                  styles.watchedButton,
                  {
                    backgroundColor: watched ? theme.backgroundElement : theme.accent,
                    opacity: busy || watched === null ? 0.6 : 1,
                  },
                ]}
                disabled={busy || watched === null}
                onPress={toggleWatched}>
                <ThemedText
                  type="smallBold"
                  style={{ color: watched ? theme.text : theme.accentText }}>
                  {watched === null ? '…' : watched ? t('movie.watched') : t('movie.markWatched')}
                </ThemedText>
              </Pressable>
              {/* Já assistiu? Não faz sentido oferecer o "Para assistir". */}
              {watched === false && (
                <Pressable
                  style={[
                    styles.watchedButton,
                    styles.watchlistButton,
                    {
                      backgroundColor: theme.backgroundElement,
                      opacity: inWatchlist === null ? 0.6 : 1,
                    },
                  ]}
                  disabled={inWatchlist === null}
                  onPress={toggleWatchlist}>
                  <Ionicons
                    name={inWatchlist ? 'bookmark' : 'bookmark-outline'}
                    size={16}
                    color={inWatchlist ? theme.accent : theme.text}
                  />
                  <ThemedText
                    type="smallBold"
                    style={{ color: inWatchlist ? theme.accent : theme.text }}>
                    {t('movie.toWatch')}
                  </ThemedText>
                </Pressable>
              )}
            </View>

            {movie.overview ? (
              <ThemedText type="small" themeColor="textSecondary">
                {movie.overview}
              </ThemedText>
            ) : null}

            <Recommendations
              media="movie"
              tmdbId={movieId}
              genres={movie.genres}
              enabled={watched === true}
              style={styles.recommendations}
            />

            <WatchProviders media="movie" tmdbId={movieId} />

            <View style={[styles.ratingCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{t('movie.yourRating')}</ThemedText>
              <StarRating value={myRating} onChange={handleRate} />
              {average && average.count > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('movie.communityAverage', {
                    rating: (average.average / 2).toFixed(1),
                    count: average.count,
                  })}
                </ThemedText>
              )}
            </View>

            <CastList media="movie" tmdbId={movieId} />

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
  backdrop: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  poster: {
    width: 92,
    height: 138,
    borderRadius: 8,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
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
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  watchedButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  watchlistButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  ratingCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  // Anula o padding da lista de comentários para o carrossel correr até a
  // borda da tela, como nas outras telas.
  recommendations: {
    marginHorizontal: -Spacing.three,
  },
});
