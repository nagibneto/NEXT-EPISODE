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

export function searchShows(query: string, page = 1, firstAirDateYear?: number) {
  return get<{ results: TmdbShowSummary[]; total_pages: number }>('/search/tv', {
    query,
    page: String(page),
    include_adult: 'false',
    ...(firstAirDateYear ? { first_air_date_year: String(firstAirDateYear) } : {}),
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

// ---------- Gêneros e descoberta ----------

export interface TmdbGenre {
  id: number;
  name: string;
}

// A lista de gêneros praticamente não muda; cache pela duração do app.
const genresCache = new Map<string, Promise<TmdbGenre[]>>();

export function getGenres(media: 'tv' | 'movie') {
  let cached = genresCache.get(media);
  if (!cached) {
    cached = get<{ genres: TmdbGenre[] }>(`/genre/${media}/list`)
      .then((data) => data.genres)
      .catch((error) => {
        // Não guarda falhas no cache para permitir nova tentativa.
        genresCache.delete(media);
        throw error;
      });
    genresCache.set(media, cached);
  }
  return cached;
}

export interface DiscoverFilters {
  genreId?: number | null;
  /** Nota mínima na escala 0–10 do TMDB. */
  minRating?: number | null;
  page?: number;
}

function discoverParams(filters: DiscoverFilters) {
  const params: Record<string, string> = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    page: String(filters.page ?? 1),
  };
  if (filters.genreId) params.with_genres = String(filters.genreId);
  if (filters.minRating) {
    params['vote_average.gte'] = String(filters.minRating);
    // Sem um mínimo de votos, títulos obscuros com 1 voto nota 10 dominam a lista.
    params['vote_count.gte'] = '200';
  }
  return params;
}

export function discoverShows(filters: DiscoverFilters = {}) {
  return get<{ results: TmdbShowSummary[]; total_pages: number }>(
    '/discover/tv',
    discoverParams(filters)
  );
}

export function discoverMovies(filters: DiscoverFilters = {}) {
  return get<{ results: TmdbMovieSummary[]; total_pages: number }>(
    '/discover/movie',
    discoverParams(filters)
  );
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

export function searchMovies(query: string, page = 1, primaryReleaseYear?: number) {
  return get<{ results: TmdbMovieSummary[]; total_pages: number }>('/search/movie', {
    query,
    page: String(page),
    include_adult: 'false',
    ...(primaryReleaseYear ? { primary_release_year: String(primaryReleaseYear) } : {}),
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

/**
 * Média das notas dos episódios de cada temporada (escala 0–10 do TMDB),
 * considerando apenas episódios já votados (vote_average > 0).
 * Retorna um Map de season_number → média.
 */
export async function getSeasonAverageRatings(showId: number, seasonNumbers: number[]) {
  const ratings = new Map<number, number>();
  // O append_to_response aceita no máximo 20 sub-requisições por chamada.
  const chunks: number[][] = [];
  for (let i = 0; i < seasonNumbers.length; i += 20) {
    chunks.push(seasonNumbers.slice(i, i + 20));
  }
  const responses = await Promise.all(
    chunks.map((chunk) =>
      get<Record<string, unknown>>(`/tv/${showId}`, {
        append_to_response: chunk.map((n) => `season/${n}`).join(','),
      })
    )
  );
  for (const response of responses) {
    for (const [key, value] of Object.entries(response)) {
      const match = /^season\/(\d+)$/.exec(key);
      if (!match) continue;
      const episodes = (value as TmdbSeasonDetails).episodes ?? [];
      const rated = episodes.filter((episode) => episode.vote_average > 0);
      if (rated.length === 0) continue;
      const sum = rated.reduce((total, episode) => total + episode.vote_average, 0);
      ratings.set(Number(match[1]), sum / rated.length);
    }
  }
  return ratings;
}

export function getEpisodeDetails(showId: number, seasonNumber: number, episodeNumber: number) {
  return get<TmdbEpisode>(`/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}`);
}
