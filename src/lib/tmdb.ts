/**
 * Camada de acesso à API do TMDB (https://developer.themoviedb.org).
 *
 * Aceita os dois formatos de credencial em EXPO_PUBLIC_TMDB_API_KEY:
 * - Token de Leitura v4 (longo, começa com "eyJ") → enviado no header Authorization.
 * - Chave da API v3 (32 caracteres) → enviada como query param api_key.
 */

const BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const IS_V4_TOKEN = !!API_KEY && API_KEY.startsWith('eyJ');
const LANGUAGE = 'pt-BR';

export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function backdropUrl(path: string | null, size: 'w780' | 'w1280' = 'w780') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function stillUrl(path: string | null, size: 'w300' | 'original' = 'w300') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export interface TmdbShowSummary {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string | null;
  vote_average: number;
}

export interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  air_date: string | null;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  vote_average: number;
  runtime: number | null;
}

export interface TmdbSeasonSummary {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  poster_path: string | null;
  air_date: string | null;
}

export interface TmdbShowDetails extends TmdbShowSummary {
  number_of_seasons: number;
  number_of_episodes: number;
  status: string;
  in_production: boolean;
  genres: { id: number; name: string }[];
  seasons: TmdbSeasonSummary[];
  next_episode_to_air: TmdbEpisode | null;
  last_episode_to_air: TmdbEpisode | null;
  networks: { id: number; name: string; logo_path: string | null }[];
  /** Duração típica dos episódios em minutos (pode vir vazio). */
  episode_run_time: number[];
}

export interface TmdbSeasonDetails {
  id: number;
  name: string;
  season_number: number;
  overview: string;
  poster_path: string | null;
  episodes: TmdbEpisode[];
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      'Chave da TMDB ausente. Defina EXPO_PUBLIC_TMDB_API_KEY no arquivo .env (veja o README).'
    );
  }
  const query = new URLSearchParams({ language: LANGUAGE, ...params });
  if (!IS_V4_TOKEN) query.set('api_key', API_KEY);
  const response = await fetch(`${BASE_URL}${path}?${query}`, {
    headers: IS_V4_TOKEN ? { Authorization: `Bearer ${API_KEY}` } : undefined,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TMDB ${response.status} em ${path}: ${body}`);
  }
  return response.json() as Promise<T>;
}

export function searchShows(query: string, page = 1) {
  return get<{ results: TmdbShowSummary[]; total_pages: number }>('/search/tv', {
    query,
    page: String(page),
    include_adult: 'false',
  });
}

export function getPopularShows(page = 1) {
  return get<{ results: TmdbShowSummary[]; total_pages: number }>('/tv/popular', {
    page: String(page),
  });
}

export function getShowDetails(showId: number) {
  return get<TmdbShowDetails>(`/tv/${showId}`);
}

// Cache em memória para telas que consultam muitas séries de uma vez
// (feed social e estatísticas). Dura enquanto o app estiver aberto.
const showDetailsCache = new Map<number, Promise<TmdbShowDetails>>();

export function getShowDetailsCached(showId: number) {
  let cached = showDetailsCache.get(showId);
  if (!cached) {
    cached = getShowDetails(showId).catch((error) => {
      // Não guarda falhas no cache para permitir nova tentativa.
      showDetailsCache.delete(showId);
      throw error;
    });
    showDetailsCache.set(showId, cached);
  }
  return cached;
}

// ---------- Filmes ----------

export interface TmdbMovieSummary {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  vote_average: number;
}

export interface TmdbMovieDetails extends TmdbMovieSummary {
  genres: { id: number; name: string }[];
  /** Duração em minutos (pode vir 0 quando o TMDB não tem o dado). */
  runtime: number | null;
  status: string;
  tagline: string | null;
}

export function searchMovies(query: string, page = 1) {
  return get<{ results: TmdbMovieSummary[]; total_pages: number }>('/search/movie', {
    query,
    page: String(page),
    include_adult: 'false',
  });
}

export function getPopularMovies(page = 1) {
  return get<{ results: TmdbMovieSummary[]; total_pages: number }>('/movie/popular', {
    page: String(page),
  });
}

export function getMovieDetails(movieId: number) {
  return get<TmdbMovieDetails>(`/movie/${movieId}`);
}

// Mesmo esquema de cache das séries, para telas que consultam muitos filmes
// de uma vez (estatísticas).
const movieDetailsCache = new Map<number, Promise<TmdbMovieDetails>>();

export function getMovieDetailsCached(movieId: number) {
  let cached = movieDetailsCache.get(movieId);
  if (!cached) {
    cached = getMovieDetails(movieId).catch((error) => {
      // Não guarda falhas no cache para permitir nova tentativa.
      movieDetailsCache.delete(movieId);
      throw error;
    });
    movieDetailsCache.set(movieId, cached);
  }
  return cached;
}

export function getSeasonDetails(showId: number, seasonNumber: number) {
  return get<TmdbSeasonDetails>(`/tv/${showId}/season/${seasonNumber}`);
}

export function getEpisodeDetails(showId: number, seasonNumber: number, episodeNumber: number) {
  return get<TmdbEpisode>(`/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}`);
}
