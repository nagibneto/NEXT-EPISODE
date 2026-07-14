import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CommentsScreen } from '@/components/comments-screen';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { WatchProviders } from '@/components/watch-providers';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  getEpisodeAverageRating,
  getMyEpisodeRating,
  isMovieWatched,
  markMovieWatched,
  rateEpisode,
} from '@/lib/db';
import { backdropUrl, getMovieDetails, posterUrl, type TmdbMovieDetails } from '@/lib/tmdb';

export default function MovieDetailsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);

  const [movie, setMovie] = useState<TmdbMovieDetails | null>(null);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMovieDetails(movieId)
      .then(setMovie)
      .catch((err) => setError(errorMessage(err, 'Erro ao carregar o filme.')));
    getEpisodeAverageRating(movieId, 0, 0, 'movie')
      .then(setAverage)
      .catch(() => {});
    if (user) {
      isMovieWatched(user.id, movieId)
        .then(setWatched)
        .catch(() => setWatched(false));
      getMyEpisodeRating(user.id, movieId, 0, 0, 'movie')
        .then(setMyRating)
        .catch(() => {});
    }
  }, [movieId, user]);

  async function toggleWatched() {
    if (!user || !movie || watched === null) return;
    setBusy(true);
    try {
      await markMovieWatched(
        user.id,
        { tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path },
        !watched
      );
      setWatched(!watched);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível atualizar.'));
    } finally {
      setBusy(false);
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
      setError(errorMessage(err, 'Não foi possível salvar a nota.'));
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
        lockedText="Você ainda não marcou este filme como assistido. Os comentários podem conter spoilers."
        header={
          <View style={styles.header}>
            {backdrop && (
              <Image source={{ uri: backdrop }} style={styles.backdrop} contentFit="cover" />
            )}
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
                  {[year, movie.runtime ? `${movie.runtime} min` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ⭐ {movie.vote_average.toFixed(1)} (TMDB)
                </ThemedText>
              </View>
            </View>

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
                {watched === null ? '…' : watched ? '✓ Assistido' : '+ Marcar como assistido'}
              </ThemedText>
            </Pressable>

            <WatchProviders media="movie" tmdbId={movieId} />

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

            {movie.overview ? (
              <ThemedText type="small" themeColor="textSecondary">
                {movie.overview}
              </ThemedText>
            ) : null}

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
  watchedButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ratingCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
