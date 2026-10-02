/**
 * Motor da aba "Para você": prateleiras de indicação montadas a partir do
 * gosto do usuário e, quando ele informa, só com o que está nos streamings
 * que ele assina.
 *
 * O gosto sai de duas fontes do próprio app: favoritos (sinal forte) e o
 * histórico — filmes assistidos ou séries seguidas, os mais recentes pesando
 * mais. Desses "títulos de referência" saem:
 *
 * - a prateleira principal, que soma as listas "quem viu também viu" do TMDB
 *   de vários títulos de referência (o que aparece para mais de um sobe);
 * - prateleiras "Porque você viu X", uma por título recente;
 * - os gêneros preferidos, que viram prateleiras próprias.
 *
 * As demais prateleiras (em alta, mais bem avaliados, lançamentos…) vêm do
 * /discover, que já filtra por streaming no servidor. As listas de
 * recomendação do TMDB não aceitam esse filtro, então ali a disponibilidade é
 * conferida título a título (com cache — ver getWatchProvidersCached).
 */

import { getFavorites, getFollowedShows, getWatchedMovies, getWatchlistMovies } from './db';
import { localizedTitle } from './locale';
import {
  discoverCatalog,
  getMovieDetailsCached,
  getRelatedMovies,
  getRelatedShows,
  getShowDetailsCached,
  getWatchProvidersCached,
  type CatalogQuery,
  type TmdbMovieSummary,
  type TmdbShowSummary,
} from './tmdb';

export type DiscoverMedia = 'tv' | 'movie';

export interface DiscoverItem {
  id: number;
  title: string;
  posterPath: string | null;
  year: string | null;
  voteAverage: number;
  voteCount: number;
  genreIds: number[];
  /** Título de referência que puxou a indicação ("Se curtiu X"). */
  because?: string;
}

/** Título que o usuário já viu/favoritou, usado como ponto de partida. */
export interface Seed {
  id: number;
  title: string;
  weight: number;
}

export interface Taste {
  media: DiscoverMedia;
  /** Do mais forte ao mais fraco. Vazio = usuário novo, sem histórico. */
  seeds: Seed[];
  /** Histórico na ordem em que aconteceu, do mais recente ao mais antigo. */
  recent: Seed[];
  /** Gêneros por afinidade, do mais forte ao mais fraco. */
  topGenreIds: number[];
  /** Afinidade de cada gênero, normalizada de 0 a 1. */
  genreAffinity: Map<number, number>;
  /** Já assistidos, seguidos ou na lista — não faz sentido indicar de novo. */
  excludeIds: Set<number>;
  /** Retrato da coleção usada no cálculo (ver librarySignature). */
  signature: string;
}

/** Filtros que valem para todas as prateleiras da tela. */
export interface ShelfFilter {
  /** Gênero escolhido nos chips do topo; `null` = sem filtro. */
  genreId: number | null;
  /** Streamings assinados; vazio = qualquer lugar. */
  providerIds: number[];
}

/** Peso de um favorito como referência de gosto. */
const FAVORITE_WEIGHT = 3;

/** Peso do item mais recente do histórico; cai devagar até os mais antigos. */
const HISTORY_WEIGHT = 2;

/** Quantos itens do histórico entram no perfil de gosto. */
const HISTORY_USED = 15;

/** Quantos títulos de referência o perfil guarda. */
const MAX_SEEDS = 12;

/** De quantas referências a prateleira principal junta as recomendações. */
const FOR_YOU_SEEDS = 6;

/** Quantos títulos cada prateleira mostra. */
const SHELF_SIZE = 20;

/**
 * Teto de títulos conferidos no "onde assistir" por prateleira. Cada um é uma
 * requisição; acima disso a tela demora e o ganho é pequeno.
 */
const MAX_PROVIDER_CHECKS = 40;
const PROVIDER_CHECK_BATCH = 10;

/** Corte de qualidade das listas de recomendação, o mesmo do recommendations.ts. */
const MIN_VOTE_COUNT = 50;
const MIN_VOTE_AVERAGE = 6;
const RATING_PIVOT = 6.5;
const RATING_WEIGHT = 0.35;

/** Bônus para indicação dos gêneros que o usuário mais vê. */
const GENRE_WEIGHT = 1.5;

/** Notícias, reality e talk show — não são o que se procura numa indicação. */
const EXCLUDED_TV_GENRES = new Set([10763, 10764, 10767]);

function fromShow(show: TmdbShowSummary): DiscoverItem {
  return {
    id: show.id,
    title: show.name,
    posterPath: show.poster_path,
    year: show.first_air_date ? show.first_air_date.slice(0, 4) : null,
    voteAverage: show.vote_average,
    voteCount: show.vote_count ?? 0,
    genreIds: show.genre_ids ?? [],
  };
}

function fromMovie(movie: TmdbMovieSummary): DiscoverItem {
  return {
    id: movie.id,
    title: movie.title,
    posterPath: movie.poster_path,
    year: movie.release_date ? movie.release_date.slice(0, 4) : null,
    voteAverage: movie.vote_average,
    voteCount: movie.vote_count ?? 0,
    genreIds: movie.genre_ids ?? [],
  };
}

/** As listas de recomendação do TMDB trazem muito título obscuro ou fraco. */
function isGoodEnough(item: DiscoverItem) {
  return item.voteCount >= MIN_VOTE_COUNT && item.voteAverage >= MIN_VOTE_AVERAGE;
}

function normalize(media: DiscoverMedia, list: (TmdbShowSummary | TmdbMovieSummary)[]) {
  return media === 'tv'
    ? (list as TmdbShowSummary[]).map(fromShow)
    : (list as TmdbMovieSummary[]).map(fromMovie);
}

/** O mínimo para aparecer em qualquer prateleira: pôster, fora da lista do usuário. */
function isShowable(item: DiscoverItem, taste: Taste) {
  if (!item.posterPath) return false;
  if (taste.excludeIds.has(item.id)) return false;
  if (taste.media === 'tv' && item.genreIds.some((id) => EXCLUDED_TV_GENRES.has(id))) return false;
  return true;
}

// ---------- Perfil de gosto ----------

/** Perfil de quem ainda não tem histórico (ou quando a consulta falha). */
export function emptyTaste(media: DiscoverMedia): Taste {
  return {
    media,
    seeds: [],
    recent: [],
    topGenreIds: [],
    genreAffinity: new Map(),
    excludeIds: new Set(),
    signature: '',
  };
}

/** O que o usuário tem no app e que define o gosto dele numa mídia. */
interface Library {
  favorites: { tmdb_id: number; title: string; title_en: string | null }[];
  /** Assistidos (filme) ou seguidos (série), do mais recente ao mais antigo. */
  history: { id: number; title: string }[];
  watchlist: { tmdb_id: number }[];
}

async function loadLibrary(userId: string, media: DiscoverMedia, language: string): Promise<Library> {
  const [favorites, history, watchlist] = await Promise.all([
    getFavorites(userId).catch(() => []),
    media === 'tv'
      ? getFollowedShows(userId)
          .then((shows) =>
            shows.map((show) => ({
              id: show.tmdb_id,
              title: localizedTitle(show.name, show.name_en, language),
            }))
          )
          .catch(() => [])
      : getWatchedMovies(userId)
          .then((movies) =>
            movies.map((movie) => ({
              id: movie.tmdb_id,
              title: localizedTitle(movie.title, movie.title_en, language),
            }))
          )
          .catch(() => []),
    media === 'movie'
      ? getWatchlistMovies(userId).catch(() => [])
      : Promise.resolve([] as { tmdb_id: number }[]),
  ]);
  return {
    favorites: favorites.filter((favorite) => favorite.media_type === media),
    history,
    watchlist,
  };
}

/**
 * Retrato da coleção: muda quando o usuário assiste, segue, favorita ou põe
 * na lista algo da mídia (inclusive a ordem do histórico, que define o
 * "Porque você viu X"). A tela compara com o do gosto atual para saber se
 * precisa recalcular.
 */
function signatureOf(library: Library) {
  return [
    library.favorites.map((favorite) => favorite.tmdb_id).join(','),
    library.history
      .slice(0, HISTORY_USED)
      .map((item) => item.id)
      .join(','),
    // Fora do perfil de gosto, mas sai das prateleiras: conta só a presença.
    library.history.length,
    library.watchlist
      .map((movie) => movie.tmdb_id)
      .sort((a, b) => a - b)
      .join(','),
  ].join('|');
}

export async function librarySignature(userId: string, media: DiscoverMedia, language: string) {
  return signatureOf(await loadLibrary(userId, media, language));
}

export async function loadTaste(
  userId: string,
  media: DiscoverMedia,
  language: string
): Promise<Taste> {
  const library = await loadLibrary(userId, media, language);
  const { history, watchlist } = library;
  const mediaFavorites = library.favorites;
  const recent: Seed[] = history.slice(0, HISTORY_USED).map((item, index) => ({
    ...item,
    weight: HISTORY_WEIGHT * (1 - index / (HISTORY_USED * 2)),
  }));

  // Favorito que também está no histórico soma os dois pesos.
  const byId = new Map<number, Seed>();
  for (const favorite of mediaFavorites) {
    byId.set(favorite.tmdb_id, {
      id: favorite.tmdb_id,
      title: localizedTitle(favorite.title, favorite.title_en, language),
      weight: FAVORITE_WEIGHT,
    });
  }
  for (const seed of recent) {
    const existing = byId.get(seed.id);
    if (existing) existing.weight += seed.weight;
    else byId.set(seed.id, { ...seed });
  }
  const seeds = [...byId.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_SEEDS);

  // Gêneros vêm do detalhe de cada referência (em cache — as telas de
  // detalhe e estatísticas já consultam os mesmos títulos).
  const details = await Promise.allSettled(
    seeds.map((seed) =>
      media === 'tv' ? getShowDetailsCached(seed.id) : getMovieDetailsCached(seed.id)
    )
  );
  const genreScore = new Map<number, number>();
  details.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const genre of result.value.genres) {
      genreScore.set(genre.id, (genreScore.get(genre.id) ?? 0) + seeds[index].weight);
    }
  });
  const topGenreIds = [...genreScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const maxScore = Math.max(1, ...genreScore.values());
  const genreAffinity = new Map(
    [...genreScore.entries()].map(([id, score]) => [id, score / maxScore])
  );

  return {
    media,
    seeds,
    recent,
    topGenreIds,
    genreAffinity,
    excludeIds: new Set([
      ...history.map((item) => item.id),
      ...mediaFavorites.map((favorite) => favorite.tmdb_id),
      ...watchlist.map((movie) => movie.tmdb_id),
    ]),
    signature: signatureOf(library),
  };
}

// ---------- Disponibilidade ----------

/**
 * Mantém só o que está na assinatura de algum dos streamings, na ordem
 * recebida. Confere em lotes e para assim que junta o suficiente.
 */
async function keepOnProviders(
  media: DiscoverMedia,
  items: DiscoverItem[],
  providerIds: number[]
): Promise<DiscoverItem[]> {
  if (providerIds.length === 0) return items;
  const wanted = new Set(providerIds);
  const candidates = items.slice(0, MAX_PROVIDER_CHECKS);
  const kept: DiscoverItem[] = [];
  for (let i = 0; i < candidates.length && kept.length < SHELF_SIZE; i += PROVIDER_CHECK_BATCH) {
    const batch = candidates.slice(i, i + PROVIDER_CHECK_BATCH);
    const available = await Promise.all(
      batch.map((item) =>
        getWatchProvidersCached(media, item.id)
          .then((providers) => providers.flatrate.some((p) => wanted.has(p.provider_id)))
          .catch(() => false)
      )
    );
    batch.forEach((item, index) => {
      if (available[index]) kept.push(item);
    });
  }
  return kept;
}

// ---------- Prateleiras ----------

function getRelated(media: DiscoverMedia, id: number, kind: 'recommendations' | 'similar') {
  return media === 'tv'
    ? getRelatedShows(id, kind).then((data) => data.results.map(fromShow))
    : getRelatedMovies(id, kind).then((data) => data.results.map(fromMovie));
}

/** Lista do /discover já sem o que o usuário viu, completando com a página 2 se esvaziar. */
export async function catalogShelf(
  taste: Taste,
  filter: ShelfFilter,
  query: CatalogQuery
): Promise<DiscoverItem[]> {
  const fullQuery: CatalogQuery = {
    ...query,
    genreIds: filter.genreId ? [filter.genreId] : query.genreIds,
    providerIds: filter.providerIds,
  };
  const first = await discoverCatalog(taste.media, fullQuery);
  let items = normalize(taste.media, first.results).filter((item) => isShowable(item, taste));
  // Quem já viu muita coisa popular esvazia a primeira página.
  if (items.length < SHELF_SIZE / 2 && first.total_pages > 1) {
    const second = await discoverCatalog(taste.media, { ...fullQuery, page: 2 }).catch(
      () => null
    );
    if (second) {
      const seen = new Set(items.map((item) => item.id));
      items = items.concat(
        normalize(taste.media, second.results).filter(
          (item) => isShowable(item, taste) && !seen.has(item.id)
        )
      );
    }
  }
  return items.slice(0, SHELF_SIZE);
}

/**
 * Prateleira principal: junta o "quem viu também viu" de vários títulos de
 * referência. Pontua pela força da referência, pela posição na lista, pela
 * afinidade de gênero e pela nota. Sem histórico (ou se sobrar pouco),
 * completa com o catálogo dos gêneros preferidos.
 */
export async function forYouShelf(taste: Taste, filter: ShelfFilter): Promise<DiscoverItem[]> {
  const seeds = taste.seeds.slice(0, FOR_YOU_SEEDS);
  const lists = await Promise.allSettled(
    seeds.map((seed) => getRelated(taste.media, seed.id, 'recommendations'))
  );

  const scored = new Map<number, { item: DiscoverItem; score: number; best: number }>();
  lists.forEach((result, seedIndex) => {
    if (result.status !== 'fulfilled') return;
    const seed = seeds[seedIndex];
    result.value.forEach((item, position) => {
      if (item.id === seed.id || !isShowable(item, taste)) return;
      if (filter.genreId && !item.genreIds.includes(filter.genreId)) return;
      const gain = seed.weight * (1 - Math.min(position, 20) / 40);
      const existing = scored.get(item.id);
      if (!existing) {
        scored.set(item.id, { item: { ...item, because: seed.title }, score: gain, best: gain });
        return;
      }
      existing.score += gain;
      // O "Se curtiu X" mostra a referência que mais contribuiu.
      if (gain > existing.best) {
        existing.best = gain;
        existing.item.because = seed.title;
      }
    });
  });

  const rank = ({ item, score }: { item: DiscoverItem; score: number }) => {
    const affinity = item.genreIds.reduce(
      (best, id) => Math.max(best, taste.genreAffinity.get(id) ?? 0),
      0
    );
    return score + affinity * GENRE_WEIGHT + (item.voteAverage - RATING_PIVOT) * RATING_WEIGHT;
  };
  const ranked = [...scored.values()]
    .filter(({ item }) => isGoodEnough(item))
    .sort((a, b) => rank(b) - rank(a))
    .map(({ item }) => item);

  const picked = await keepOnProviders(taste.media, ranked, filter.providerIds);
  if (picked.length >= SHELF_SIZE / 2) return picked.slice(0, SHELF_SIZE);

  // Usuário novo ou pouca coisa nos streamings dele: completa com os títulos
  // populares e bem avaliados dos gêneros que ele mais vê.
  const fill = await catalogShelf(taste, filter, {
    genreIds: taste.topGenreIds.slice(0, 3),
    minVotes: 300,
    minRating: 6.5,
  }).catch(() => []);
  const seen = new Set(picked.map((item) => item.id));
  return picked.concat(fill.filter((item) => !seen.has(item.id))).slice(0, SHELF_SIZE);
}

/** "Porque você viu X": recomendações e similares de um título só. */
export async function becauseShelf(
  taste: Taste,
  filter: ShelfFilter,
  seed: Seed
): Promise<DiscoverItem[]> {
  const lists = await Promise.allSettled([
    getRelated(taste.media, seed.id, 'recommendations'),
    getRelated(taste.media, seed.id, 'similar'),
  ]);
  const seen = new Set<number>();
  const items: DiscoverItem[] = [];
  for (const result of lists) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (seen.has(item.id) || item.id === seed.id || !isShowable(item, taste)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  const good = items.filter(isGoodEnough);
  return (await keepOnProviders(taste.media, good, filter.providerIds)).slice(0, SHELF_SIZE);
}

/** Data de N meses atrás, no formato do /discover. */
export function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

/**
 * Mínimo de votos de uma prateleira de catálogo, dado em escala de filme:
 * série recebe bem menos votos no TMDB, e o mesmo corte esvaziaria a lista.
 */
export function minVotesFor(media: DiscoverMedia, movieVotes: number) {
  return media === 'tv' ? Math.round(movieVotes / 3) : movieVotes;
}
