/**
 * Camada de acesso à API do TMDB (https://developer.themoviedb.org).
 *
 * Aceita os dois formatos de credencial em EXPO_PUBLIC_TMDB_API_KEY:
 * - Token de Leitura v4 (longo, começa com "eyJ") → enviado no header Authorization.
 * - Chave da API v3 (32 caracteres) → enviada como query param api_key.
 */

import { i18n, DEFAULT_LANGUAGE, type AppLanguage } from './i18n';

const BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const IS_V4_TOKEN = !!API_KEY && API_KEY.startsWith('eyJ');

// Definido por useLanguagePreference sempre que o idioma do app muda.
let currentLanguage: AppLanguage = DEFAULT_LANGUAGE;

export function setTmdbLanguage(lang: AppLanguage) {
  currentLanguage = lang;
}

/** Região usada para catálogo de streaming — não existe seletor próprio, segue o idioma. */
function currentRegion() {
  return currentLanguage === 'en-US' ? 'US' : 'BR';
}

export function otherLanguage(lang: AppLanguage): AppLanguage {
  return lang === 'en-US' ? 'pt-BR' : 'en-US';
}

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
  /** Campos que só vêm em listagens (busca, discover, recomendações), não no detalhe. */
  genre_ids?: number[];
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
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
    throw new Error(i18n.t('tmdb.missingApiKey'));
  }
  const query = new URLSearchParams({ language: currentLanguage, ...params });
  if (!IS_V4_TOKEN) query.set('api_key', API_KEY);
  const response = await fetch(`${BASE_URL}${path}?${query}`, {
    headers: IS_V4_TOKEN ? { Authorization: `Bearer ${API_KEY}` } : undefined,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      i18n.t('tmdb.requestError', { status: response.status, path, body })
    );
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

export function getShowDetails(showId: number, language: AppLanguage = currentLanguage) {
  return get<TmdbShowDetails>(`/tv/${showId}`, { language });
}

// ---------- Gêneros e descoberta ----------

export interface TmdbGenre {
  id: number;
  name: string;
}

// A lista de gêneros praticamente não muda; cache pela duração do app.
const genresCache = new Map<string, Promise<TmdbGenre[]>>();

export function getGenres(media: 'tv' | 'movie') {
  const key = `${media}-${currentLanguage}`;
  let cached = genresCache.get(key);
  if (!cached) {
    cached = get<{ genres: TmdbGenre[] }>(`/genre/${media}/list`)
      .then((data) => data.genres)
      .catch((error) => {
        // Não guarda falhas no cache para permitir nova tentativa.
        genresCache.delete(key);
        throw error;
      });
    genresCache.set(key, cached);
  }
  return cached;
}

export interface DiscoverFilters {
  genreId?: number | null;
  /** Nota mínima (inclusiva) na escala 0–10 do TMDB. */
  ratingFrom?: number | null;
  /** Nota máxima (inclusiva) na escala 0–10 do TMDB. */
  ratingTo?: number | null;
  /**
   * Streamings (ids de watch provider do TMDB) onde o título está disponível na
   * região. Vários ids = disponível em qualquer um deles (OR).
   */
  providerIds?: number[];
  /** Ano inicial de lançamento/estreia (inclusivo). */
  yearFrom?: number | null;
  /** Ano final de lançamento/estreia (inclusivo). Igual a `yearFrom` filtra um ano só. */
  yearTo?: number | null;
  page?: number;
}

function discoverParams(filters: DiscoverFilters, media: 'tv' | 'movie') {
  const params: Record<string, string> = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    page: String(filters.page ?? 1),
  };
  if (filters.genreId) params.with_genres = String(filters.genreId);
  if (filters.ratingFrom != null) {
    params['vote_average.gte'] = String(filters.ratingFrom);
    // Sem um mínimo de votos, títulos obscuros com 1 voto nota 10 dominam a
    // lista. A partir de 9 quase nada tem 200+ votos (a comunidade raramente dá
    // média tão alta), então o corte relaxa para não devolver lista vazia.
    params['vote_count.gte'] = filters.ratingFrom >= 9 ? '50' : '200';
  }
  if (filters.ratingTo != null && filters.ratingTo < 10) {
    params['vote_average.lte'] = String(filters.ratingTo);
  }
  if (filters.providerIds?.length) {
    // "|" = disponível em qualquer um dos serviços (OR); "," seria "em todos".
    params.with_watch_providers = filters.providerIds.join('|');
    // O filtro de provider só funciona amarrado a uma região.
    params.watch_region = currentRegion();
  }
  // O intervalo de anos vira faixa de datas: séries usam a estreia, filmes a
  // data de lançamento principal. Os nomes dos parâmetros diferem entre os
  // dois endpoints do /discover.
  const dateField = media === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (filters.yearFrom) params[`${dateField}.gte`] = `${filters.yearFrom}-01-01`;
  if (filters.yearTo) params[`${dateField}.lte`] = `${filters.yearTo}-12-31`;
  return params;
}

export function discoverShows(filters: DiscoverFilters = {}) {
  return get<{ results: TmdbShowSummary[]; total_pages: number }>(
    '/discover/tv',
    discoverParams(filters, 'tv')
  );
}

export function discoverMovies(filters: DiscoverFilters = {}) {
  return get<{ results: TmdbMovieSummary[]; total_pages: number }>(
    '/discover/movie',
    discoverParams(filters, 'movie')
  );
}

// Cache em memória para telas que consultam muitas séries de uma vez
// (feed social e estatísticas). Dura enquanto o app estiver aberto.
const showDetailsCache = new Map<string, Promise<TmdbShowDetails>>();

export function getShowDetailsCached(showId: number, language: AppLanguage = currentLanguage) {
  const key = `${showId}-${language}`;
  let cached = showDetailsCache.get(key);
  if (!cached) {
    cached = getShowDetails(showId, language).catch((error) => {
      // Não guarda falhas no cache para permitir nova tentativa.
      showDetailsCache.delete(key);
      throw error;
    });
    showDetailsCache.set(key, cached);
  }
  return cached;
}

/** Nome da série nos dois idiomas suportados — usado ao gravar seguir/marcar assistido. */
export async function getShowNames(showId: number): Promise<{ name: string; name_en: string }> {
  const [pt, en] = await Promise.all([
    getShowDetailsCached(showId, 'pt-BR'),
    getShowDetailsCached(showId, 'en-US'),
  ]);
  return { name: pt.name, name_en: en.name };
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
  /** Campos que só vêm em listagens (busca, discover, recomendações), não no detalhe. */
  genre_ids?: number[];
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
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

export function getMovieDetails(movieId: number, language: AppLanguage = currentLanguage) {
  return get<TmdbMovieDetails>(`/movie/${movieId}`, { language });
}

// Mesmo esquema de cache das séries, para telas que consultam muitos filmes
// de uma vez (estatísticas).
const movieDetailsCache = new Map<string, Promise<TmdbMovieDetails>>();

export function getMovieDetailsCached(movieId: number, language: AppLanguage = currentLanguage) {
  const key = `${movieId}-${language}`;
  let cached = movieDetailsCache.get(key);
  if (!cached) {
    cached = getMovieDetails(movieId, language).catch((error) => {
      // Não guarda falhas no cache para permitir nova tentativa.
      movieDetailsCache.delete(key);
      throw error;
    });
    movieDetailsCache.set(key, cached);
  }
  return cached;
}

/** Título do filme nos dois idiomas suportados — usado ao gravar assistido/favorito/watchlist. */
export async function getMovieNames(movieId: number): Promise<{ title: string; title_en: string }> {
  const [pt, en] = await Promise.all([
    getMovieDetailsCached(movieId, 'pt-BR'),
    getMovieDetailsCached(movieId, 'en-US'),
  ]);
  return { title: pt.title, title_en: en.title };
}

/** Duração típica de episódio/filme quando a TMDB não informa a real. */
export const FALLBACK_RUNTIME_MIN = 40;
export const FALLBACK_MOVIE_RUNTIME_MIN = 110;

/** Duração típica de um episódio da série, com fallback quando a TMDB não informa. */
export function episodeRuntime(details: {
  episode_run_time: number[];
  last_episode_to_air: { runtime: number | null } | null;
}) {
  if (details.episode_run_time.length > 0) {
    const sum = details.episode_run_time.reduce((acc, min) => acc + min, 0);
    return sum / details.episode_run_time.length;
  }
  return details.last_episode_to_air?.runtime || FALLBACK_RUNTIME_MIN;
}

/**
 * Quantos episódios da série já foram ao ar: temporadas anteriores completas
 * (especiais fora) + posição do último episódio exibido na temporada atual.
 * O number_of_episodes sozinho não serve porque inclui episódios anunciados
 * que ainda não estrearam.
 */
export function airedEpisodeCount(details: {
  seasons: { season_number: number; episode_count: number }[];
  last_episode_to_air: { season_number: number; episode_number: number } | null;
  number_of_episodes: number;
}) {
  const last = details.last_episode_to_air;
  if (!last) return details.number_of_episodes;
  const previousSeasons = details.seasons
    .filter((s) => s.season_number > 0 && s.season_number < last.season_number)
    .reduce((acc, s) => acc + s.episode_count, 0);
  return previousSeasons + last.episode_number;
}

/**
 * Quantos episódios de uma temporada específica já foram ao ar. O
 * `episode_count` do TMDB conta episódios anunciados que ainda não estrearam,
 * então uma temporada futura precisa valer zero — senão quem terminou a série
 * nunca é considerado em dia só porque a próxima temporada já está no catálogo.
 */
export function airedEpisodesInSeason(
  details: { last_episode_to_air: { season_number: number; episode_number: number } | null },
  season: { season_number: number; episode_count: number }
) {
  const last = details.last_episode_to_air;
  // Sem episódio exibido registrado, assume o que o TMDB informa (séries
  // antigas às vezes não têm o campo preenchido).
  if (!last) return season.episode_count;
  if (season.season_number < last.season_number) return season.episode_count;
  if (season.season_number === last.season_number) return last.episode_number;
  return 0;
}

/** Se este episódio é o mais recente já exibido da série inteira. */
export function isLatestAiredEpisode(
  lastEpisodeToAir: { season_number: number; episode_number: number } | null,
  seasonNumber: number,
  episodeNumber: number
) {
  return (
    !!lastEpisodeToAir &&
    lastEpisodeToAir.season_number === seasonNumber &&
    lastEpisodeToAir.episode_number === episodeNumber
  );
}

// ---------- Onde assistir ----------

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority: number;
}

export interface TmdbWatchProviders {
  /** Página do TMDB com a lista completa (crédito obrigatório ao JustWatch). */
  link: string | null;
  /** Plataformas de streaming por assinatura disponíveis no Brasil. */
  flatrate: TmdbWatchProvider[];
}

export function providerLogoUrl(path: string | null) {
  return path ? `${IMAGE_BASE}/w92${path}` : null;
}

/**
 * Em quais streamings o título está disponível na região do usuário. Os
 * dados vêm do JustWatch via TMDB — a atribuição "JustWatch" na UI é
 * exigência deles.
 */
export async function getWatchProviders(
  media: 'tv' | 'movie',
  id: number
): Promise<TmdbWatchProviders> {
  const data = await get<{
    results: Record<string, { link?: string; flatrate?: TmdbWatchProvider[] }>;
  }>(`/${media}/${id}/watch/providers`);
  const region = data.results?.[currentRegion()];
  const flatrate = (region?.flatrate ?? [])
    // O JustWatch lista variantes do mesmo serviço ("Netflix Standard with
    // Ads", "HBO Max Amazon Channel") — só os planos/revendas principais
    // interessam aqui.
    .filter((p) => !/with ads|amazon channel|apple tv channel/i.test(p.provider_name))
    .sort((a, b) => a.display_priority - b.display_priority);
  return { link: region?.link ?? null, flatrate };
}

// Como os gêneros, a lista de streamings da região quase não muda; cache pela
// duração do app (uma entrada por combinação de mídia + região).
const streamingProvidersCache = new Map<string, Promise<TmdbWatchProvider[]>>();

/**
 * Todos os streamings com catálogo na região do usuário, ordenados por
 * relevância (dados JustWatch via TMDB — a atribuição "JustWatch" na UI é
 * exigência deles).
 */
export function getStreamingProviders(media: 'tv' | 'movie') {
  const region = currentRegion();
  const key = `${media}-${region}`;
  let cached = streamingProvidersCache.get(key);
  if (!cached) {
    cached = get<{
      results: (TmdbWatchProvider & { display_priorities?: Record<string, number> })[];
    }>(`/watch/providers/${media}`, { watch_region: region })
      .then((data) =>
        data.results
          // Mesmo critério do getWatchProviders: variantes/revendas fora.
          .filter((p) => !/with ads|amazon channel|apple tv channel/i.test(p.provider_name))
          .sort(
            (a, b) =>
              (a.display_priorities?.[region] ?? a.display_priority) -
              (b.display_priorities?.[region] ?? b.display_priority)
          )
      )
      .catch((error) => {
        // Não guarda falhas no cache para permitir nova tentativa.
        streamingProvidersCache.delete(key);
        throw error;
      });
    streamingProvidersCache.set(key, cached);
  }
  return cached;
}

export function getSeasonDetails(showId: number, seasonNumber: number) {
  return get<TmdbSeasonDetails>(`/tv/${showId}/season/${seasonNumber}`);
}

// Mesmo esquema de cache das séries, para o "assistir a seguir" da watchlist,
// que consulta uma temporada por série seguida.
const seasonDetailsCache = new Map<string, Promise<TmdbSeasonDetails>>();

export function getSeasonDetailsCached(showId: number, seasonNumber: number) {
  const key = `${showId}-${seasonNumber}-${currentLanguage}`;
  let cached = seasonDetailsCache.get(key);
  if (!cached) {
    cached = getSeasonDetails(showId, seasonNumber).catch((error) => {
      // Não guarda falhas no cache para permitir nova tentativa.
      seasonDetailsCache.delete(key);
      throw error;
    });
    seasonDetailsCache.set(key, cached);
  }
  return cached;
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

// ---------- Elenco ----------

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

/**
 * Elenco de série no formato "agregado" (todas as temporadas). O
 * `/tv/{id}/credits` devolve só o elenco do último episódio — em animação
 * costuma vir vazio (X-Men '97: 0 contra 93 aqui) e em série longa traz um
 * punhado de nomes. Este é o endpoint certo para série.
 */
interface TmdbAggregateCastMember {
  id: number;
  name: string;
  profile_path: string | null;
  order: number;
  total_episode_count: number;
  roles: { character: string; episode_count: number }[];
}

export function getShowAggregateCredits(showId: number) {
  return get<{ cast: TmdbAggregateCastMember[] }>(`/tv/${showId}/aggregate_credits`);
}

/** Papéis que não representam o título e poluem "elenco principal". */
const GENERIC_ROLE =
  /additional voices|vozes adicionais|uncredited|não creditado|himself|herself|themselves|narrator|narrador/i;

export function getShowCredits(showId: number) {
  return get<{ cast: TmdbCastMember[] }>(`/tv/${showId}/credits`);
}

export function getMovieCredits(movieId: number) {
  return get<{ cast: TmdbCastMember[] }>(`/movie/${movieId}/credits`);
}

/**
 * Elenco principal do título, já ordenado por relevância e sem papéis
 * genéricos. Série usa o elenco agregado; filme, os créditos normais.
 */
function loadMainCast(media: 'tv' | 'movie', tmdbId: number): Promise<TmdbCastMember[]> {
  if (media === 'movie') {
    // Créditos de filme já vêm na ordem de bilhetagem.
    return getMovieCredits(tmdbId).then((data) => data.cast);
  }
  return getShowAggregateCredits(tmdbId).then((data) => {
    const named = data.cast.filter(
      (member) => !member.roles.every((role) => GENERIC_ROLE.test(role.character ?? ''))
    );
    // Se sobrou nada (elenco todo marcado como genérico), é melhor mostrar
    // a lista original do que lista nenhuma.
    const cast = named.length > 0 ? named : data.cast;
    return (
      cast
        // Número de episódios é o critério confiável de protagonismo: o
        // campo `order` vem inutilizável em animação (papéis de 1 episódio
        // apareciam na frente do Cyclops em X-Men '97).
        .sort(
          (a, b) =>
            b.total_episode_count - a.total_episode_count || (a.order ?? 9999) - (b.order ?? 9999)
        )
        .map((member) => ({
          id: member.id,
          name: member.name,
          profile_path: member.profile_path,
          order: member.order,
          character: member.roles[0]?.character ?? '',
        }))
    );
  });
}

// A tela de detalhes pede o elenco duas vezes (carrossel de elenco e motor de
// recomendações); o cache evita a requisição repetida.
const creditsCache = new Map<string, Promise<TmdbCastMember[]>>();

export function getCreditsCached(media: 'tv' | 'movie', tmdbId: number) {
  const key = `${media}-${tmdbId}-${currentLanguage}`;
  let cached = creditsCache.get(key);
  if (!cached) {
    cached = loadMainCast(media, tmdbId)
      .catch((error) => {
        // Não guarda falhas no cache para permitir nova tentativa.
        creditsCache.delete(key);
        throw error;
      });
    creditsCache.set(key, cached);
  }
  return cached;
}

// ---------- Recomendações ----------

/**
 * "Quem viu isso também viu" (`recommendations`) e "parecidos" (`similar`) do
 * próprio TMDB. São listas diferentes: a primeira é comportamental, a segunda
 * vem de gênero/palavras-chave.
 */
export function getRelatedShows(showId: number, kind: 'recommendations' | 'similar') {
  return get<{ results: TmdbShowSummary[] }>(`/tv/${showId}/${kind}`);
}

export function getRelatedMovies(movieId: number, kind: 'recommendations' | 'similar') {
  return get<{ results: TmdbMovieSummary[] }>(`/movie/${movieId}/${kind}`);
}

/** Séries em que a pessoa atuou. `episode_count` separa papel fixo de ponta. */
export function getPersonShowCredits(personId: number) {
  return get<{ cast: (TmdbShowSummary & { episode_count?: number })[] }>(
    `/person/${personId}/tv_credits`
  );
}

/** Filmes em que a pessoa atuou. `order` é a posição dela no elenco. */
export function getPersonMovieCredits(personId: number) {
  return get<{ cast: (TmdbMovieSummary & { order?: number })[] }>(
    `/person/${personId}/movie_credits`
  );
}

/** Quantos anos para trás contam como lançamento "novo" nas recomendações. */
const RECENT_YEARS = 3;

function recentDateFloor() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - RECENT_YEARS);
  return date.toISOString().slice(0, 10);
}

/**
 * Títulos recentes e populares dos mesmos gêneros — a fatia "novidades em alta"
 * das recomendações. Os gêneros são combinados com AND para a lista ficar
 * realmente parecida, não só "o que está popular".
 */
export function discoverRecentShows(genreIds: number[]) {
  return get<{ results: TmdbShowSummary[] }>('/discover/tv', {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    include_null_first_air_dates: 'false',
    'first_air_date.gte': recentDateFloor(),
    'vote_count.gte': '100',
    ...(genreIds.length > 0 ? { with_genres: genreIds.join(',') } : {}),
  });
}

export function discoverRecentMovies(genreIds: number[]) {
  return get<{ results: TmdbMovieSummary[] }>('/discover/movie', {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    'primary_release_date.gte': recentDateFloor(),
    'vote_count.gte': '100',
    ...(genreIds.length > 0 ? { with_genres: genreIds.join(',') } : {}),
  });
}

// ---------- Busca por pessoas (permite achar títulos pelo nome do ator) ----------

/** Título "conhecido por" de uma pessoa, no formato bruto do /search/person. */
export type TmdbPersonKnownFor =
  | (TmdbShowSummary & { media_type: 'tv' })
  | (TmdbMovieSummary & { media_type: 'movie' });

export interface TmdbPersonSummary {
  id: number;
  name: string;
  profile_path: string | null;
  known_for: TmdbPersonKnownFor[];
}

export function searchPeople(query: string, page = 1) {
  return get<{ results: TmdbPersonSummary[]; total_pages: number }>('/search/person', {
    query,
    page: String(page),
    include_adult: 'false',
  });
}
