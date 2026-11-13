/**
 * "Em destaque" da aba Início: os filmes mais aguardados que ainda vão estrear.
 *
 * A lista é automática (os mais populares entre as estreias da região), mas dá
 * para fixar títulos à mão em PINNED_FEATURED_MOVIE_IDS — eles entram na frente,
 * na ordem escrita. É só código: um `eas update` basta para trocar o destaque,
 * sem versão nova na loja.
 */

import { getMovieReleaseDates } from './movie-releases';
import {
  getMovieDetailsCached,
  getMovieTrailerKey,
  getUpcomingMovies,
  localToday,
  type TmdbMovieSummary,
} from './tmdb';

/**
 * Ids da TMDB dos filmes fixados no destaque (o número no fim do endereço da
 * página do filme em themoviedb.org). Um fixado sai sozinho da lista
 * PINNED_KEEP_DAYS dias depois de estrear, então esquecer um aqui não deixa a
 * Início anunciando filme velho.
 */
export const PINNED_FEATURED_MOVIE_IDS: number[] = [
  1003596, // Vingadores: Doutor Destino
];

/** Por quantos dias depois da estreia um filme fixado continua no destaque. */
const PINNED_KEEP_DAYS = 21;
const MAX_FEATURED = 5;

export interface FeaturedMovie {
  id: number;
  title: string;
  backdropPath: string | null;
  posterPath: string | null;
  /** Estreia na região do usuário (YYYY-MM-DD); null = ainda sem data. */
  date: string | null;
  /** Chave do YouTube do trailer; null = a TMDB não tem. */
  trailerKey: string | null;
}

function fromSummary(movie: TmdbMovieSummary, date: string | null) {
  return {
    id: movie.id,
    title: movie.title,
    backdropPath: movie.backdrop_path,
    posterPath: movie.poster_path,
    date,
  };
}

export async function loadFeaturedMovies(): Promise<FeaturedMovie[]> {
  const upcoming = await getUpcomingMovies();
  const upcomingById = new Map(upcoming.map((movie) => [movie.id, movie]));
  const picked: Omit<FeaturedMovie, 'trailerKey'>[] = [];

  // 1. Fixados, na ordem escrita.
  const pinnedOutside = PINNED_FEATURED_MOVIE_IDS.filter((id) => !upcomingById.has(id));
  const pinnedDates = pinnedOutside.length ? await getMovieReleaseDates(pinnedOutside) : {};
  const keepSince = localToday(-PINNED_KEEP_DAYS);
  for (const id of PINNED_FEATURED_MOVIE_IDS) {
    const listed = upcomingById.get(id);
    if (listed) {
      picked.push(fromSummary(listed, listed.release_date));
      continue;
    }
    // Fora da janela de estreias (longe demais, ou já estreou): busca o filme.
    try {
      const date = pinnedDates[id] ?? null;
      if (date && date < keepSince) continue;
      picked.push(fromSummary(await getMovieDetailsCached(id), date));
    } catch {
      // Id errado ou sem rede: o destaque segue sem ele.
    }
  }

  // 2. Completa com as estreias mais populares.
  const pickedIds = new Set(picked.map((movie) => movie.id));
  const popular = upcoming
    .filter((movie) => movie.backdrop_path && !pickedIds.has(movie.id))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  for (const movie of popular) {
    if (picked.length >= MAX_FEATURED) break;
    picked.push(fromSummary(movie, movie.release_date));
  }

  const featured = picked.filter((movie) => movie.backdropPath).slice(0, MAX_FEATURED);
  const trailers = await Promise.all(
    featured.map((movie) => getMovieTrailerKey(movie.id).catch(() => null))
  );
  return featured.map((movie, index) => ({ ...movie, trailerKey: trailers[index] }));
}
