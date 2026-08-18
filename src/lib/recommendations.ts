/**
 * Motor de "Você também pode gostar", exibido quando o usuário termina uma
 * série ou marca um filme como assistido.
 *
 * A lista sai da mistura de quatro sinais independentes do TMDB, cada um com
 * um peso. Um título que aparece em mais de um sinal soma os pesos e sobe —
 * é isso que faz a lista final ser melhor do que qualquer uma das fontes
 * sozinha:
 *
 * - `recommendations` do TMDB (comportamental: quem viu isso também viu);
 * - `similar` do TMDB (gênero e palavras-chave em comum);
 * - outros trabalhos dos atores principais do título;
 * - lançamentos recentes e populares dos mesmos gêneros.
 *
 * Cada fonte também vira o "motivo" mostrado embaixo do pôster, para a
 * indicação não parecer aleatória. Nenhuma fonte é obrigatória: se alguma
 * requisição falhar, o resto continua valendo.
 */

import {
  discoverRecentMovies,
  discoverRecentShows,
  getCreditsCached,
  getPersonMovieCredits,
  getPersonShowCredits,
  getRelatedMovies,
  getRelatedShows,
  type TmdbMovieSummary,
  type TmdbShowSummary,
} from './tmdb';

/** Quantas indicações a tela mostra. */
export const RECOMMENDATION_COUNT = 10;

/** Quantos atores do elenco principal são usados como sinal. */
const ACTORS_USED = 4;

/** Quantos títulos aproveitar da filmografia de cada ator. */
const CREDITS_PER_ACTOR = 12;

/** Quantos gêneros do título são cruzados na busca por novidades. */
const GENRES_USED = 3;

/**
 * Mínimo de episódios para uma série contar na filmografia do ator. Sem isso a
 * participação especial vira indicação: o Bryan Cranston dublou um episódio de
 * Family Guy, e Family Guy virava a principal indicação de Breaking Bad.
 */
const MIN_ACTOR_EPISODES = 4;

/** Posição máxima no elenco do filme — o mesmo corte, para pontas em filmes. */
const MAX_ACTOR_BILLING = 8;

/**
 * Máximo de indicações por motivo, para a lista não ficar monótona. O limite
 * de ator vale por ator: sem isso o elenco inteiro do Homem-Aranha cabia em
 * duas vagas da Zendaya e o Tom Holland nunca aparecia.
 */
const REASON_CAPS: Record<ReasonKey, number> = {
  fans: 4,
  actor: 2,
  trending: 3,
};

/** Peso de cada fonte na pontuação final. */
const WEIGHTS = {
  recommendations: 3,
  similar: 2,
  actor: 2.5,
  trending: 1.5,
} as const;

/** Mínimo de votos no TMDB para o título entrar — corta lançamentos obscuros. */
const MIN_VOTE_COUNT = 50;

/** Nota mínima no TMDB — as listas de "similar" trazem bastante coisa ruim. */
const MIN_VOTE_AVERAGE = 6;

/**
 * Nota a partir da qual o título ganha bônus na ordenação (e abaixo dela,
 * desconto). Não elimina ninguém, só faz o bem avaliado subir.
 */
const RATING_PIVOT = 6.5;
const RATING_WEIGHT = 0.35;

/**
 * Gêneros de TV que não são ficção seriada (notícias, talk show, reality).
 * Aparecem com frequência nas listas de "similar" e destoam da indicação.
 */
const EXCLUDED_TV_GENRES = new Set([10763, 10764, 10767]);

/**
 * Conteúdo infantil de verdade: os dois gêneros juntos, não qualquer um deles.
 * É o corte que impede Euphoria de indicar desenho da Disney só porque a
 * Zendaya começou a carreira lá.
 *
 * Um gênero sozinho pega demais: "Kids" também está em X-Men: Evolution e
 * "Família" em Avatar e Gravity Falls, que são boas indicações para público
 * adulto. Já a dupla Kids+Família marca justamente a série teen/pré-escolar
 * (No Ritmo, Agente K.C, Bluey). Em filme o par equivalente é Animação+Família.
 */
function isKidsContent(genreIds: number[], media: 'tv' | 'movie') {
  const ids = new Set(genreIds);
  return media === 'tv' ? ids.has(10762) && ids.has(10751) : ids.has(16) && ids.has(10751);
}

/**
 * Gêneros pesados demais para quem acabou de ver um título infantil (terror,
 * suspense, crime, guerra, política, mistério, faroeste).
 */
const MATURE_GENRES = new Set([27, 53, 80, 10752, 10768, 9648, 37]);

type ReasonKey = 'actor' | 'fans' | 'trending';

export interface Recommendation {
  id: number;
  title: string;
  posterPath: string | null;
  year: string | null;
  voteAverage: number;
  /** Motivo da indicação; `value` interpola o nome do ator ou do gênero. */
  reason: { key: ReasonKey; value?: string };
}

/** Forma mínima em que séries e filmes são tratados igual pelo motor. */
interface Candidate {
  id: number;
  title: string;
  posterPath: string | null;
  date: string | null;
  voteAverage: number;
  voteCount: number;
  genreIds: number[];
  adult: boolean;
}

function fromShow(show: TmdbShowSummary): Candidate {
  return {
    id: show.id,
    title: show.name,
    posterPath: show.poster_path,
    date: show.first_air_date,
    voteAverage: show.vote_average,
    voteCount: show.vote_count ?? 0,
    genreIds: show.genre_ids ?? [],
    adult: show.adult ?? false,
  };
}

function fromMovie(movie: TmdbMovieSummary): Candidate {
  return {
    id: movie.id,
    title: movie.title,
    posterPath: movie.poster_path,
    date: movie.release_date,
    voteAverage: movie.vote_average,
    voteCount: movie.vote_count ?? 0,
    genreIds: movie.genre_ids ?? [],
    adult: movie.adult ?? false,
  };
}

interface Scored {
  candidate: Candidate;
  score: number;
  reason: { key: ReasonKey; value?: string };
}

export interface RecommendationInput {
  media: 'tv' | 'movie';
  tmdbId: number;
  /** Gêneros do título de origem, do detalhe já carregado pela tela. */
  genres: { id: number; name: string }[];
  /** Títulos que o usuário já segue/assistiu — não faz sentido indicar de novo. */
  excludeIds: Set<number>;
}

/** Resultado de uma fonte: os candidatos e como rotular a indicação. */
interface SourceResult {
  candidates: Candidate[];
  weight: number;
  reason: { key: ReasonKey; value?: string };
}

/** Só o que vale a pena mostrar: com pôster, com votos e fora da lista do usuário. */
function isUsable(candidate: Candidate, input: RecommendationInput, originIsKids: boolean) {
  if (candidate.id === input.tmdbId) return false;
  if (input.excludeIds.has(candidate.id)) return false;
  if (!candidate.posterPath) return false;
  if (candidate.adult) return false;
  if (candidate.voteCount < MIN_VOTE_COUNT) return false;
  if (candidate.voteAverage < MIN_VOTE_AVERAGE) return false;
  if (input.media === 'tv' && candidate.genreIds.some((id) => EXCLUDED_TV_GENRES.has(id))) {
    return false;
  }
  // Compatibilidade de público, nos dois sentidos: título adulto não indica
  // infantil (o problema da filmografia antiga do ator) e vice-versa.
  if (!originIsKids && isKidsContent(candidate.genreIds, input.media)) return false;
  if (originIsKids && candidate.genreIds.some((id) => MATURE_GENRES.has(id))) return false;
  return true;
}

/** Consulta as filmografias dos atores principais, cada uma como uma fonte. */
async function actorSources(input: RecommendationInput): Promise<SourceResult[]> {
  const cast = await getCreditsCached(input.media, input.tmdbId).catch(() => []);
  const actors = cast.slice(0, ACTORS_USED);
  const results = await Promise.allSettled(
    actors.map((actor) =>
      input.media === 'tv'
        ? getPersonShowCredits(actor.id).then((data) =>
            data.cast
              // Papel recorrente, não participação especial.
              .filter((show) => (show.episode_count ?? 0) >= MIN_ACTOR_EPISODES)
              .map(fromShow)
          )
        : getPersonMovieCredits(actor.id).then((data) =>
            data.cast
              .filter((movie) => (movie.order ?? 99) <= MAX_ACTOR_BILLING)
              .map(fromMovie)
          )
    )
  );
  return results.flatMap((result, index) => {
    if (result.status !== 'fulfilled') return [];
    // A filmografia vem sem ordem útil; os títulos mais votados representam
    // melhor a carreira do ator do que trabalhos que ninguém viu.
    const candidates = [...result.value]
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, CREDITS_PER_ACTOR);
    return [
      {
        candidates,
        weight: WEIGHTS.actor,
        reason: { key: 'actor' as const, value: actors[index].name },
      },
    ];
  });
}

async function relatedSources(input: RecommendationInput): Promise<SourceResult[]> {
  const kinds = ['recommendations', 'similar'] as const;
  const results = await Promise.allSettled(
    kinds.map((kind) =>
      input.media === 'tv'
        ? getRelatedShows(input.tmdbId, kind).then((data) => data.results.map(fromShow))
        : getRelatedMovies(input.tmdbId, kind).then((data) => data.results.map(fromMovie))
    )
  );
  return results.flatMap((result, index) =>
    result.status === 'fulfilled'
      ? [
          {
            candidates: result.value,
            weight: WEIGHTS[kinds[index]],
            reason: { key: 'fans' as const },
          },
        ]
      : []
  );
}

async function trendingSource(input: RecommendationInput): Promise<SourceResult[]> {
  // Três gêneros cruzados deixam a busca bem específica sem esvaziar a lista —
  // com dois, "Animação + Comédia" indicava Hazbin Hotel para quem viu Bluey.
  const genres = input.genres.slice(0, GENRES_USED);
  if (genres.length === 0) return [];
  const ids = genres.map((genre) => genre.id);
  try {
    const data =
      input.media === 'tv' ? await discoverRecentShows(ids) : await discoverRecentMovies(ids);
    const candidates =
      input.media === 'tv'
        ? (data.results as TmdbShowSummary[]).map(fromShow)
        : (data.results as TmdbMovieSummary[]).map(fromMovie);
    return [
      {
        candidates,
        weight: WEIGHTS.trending,
        reason: { key: 'trending' as const, value: input.genres[0].name },
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Qual motivo mostrar quando o título veio de mais de uma fonte: o mais
 * específico primeiro ("Com Fulano" diz mais do que "Quem viu também viu").
 */
const REASON_PRIORITY: ReasonKey[] = ['actor', 'fans', 'trending'];

export async function getRecommendations(
  input: RecommendationInput
): Promise<Recommendation[]> {
  const sources = (
    await Promise.all([relatedSources(input), actorSources(input), trendingSource(input)])
  ).flat();

  const originIsKids = isKidsContent(
    input.genres.map((genre) => genre.id),
    input.media
  );

  const scored = new Map<number, Scored>();
  for (const source of sources) {
    // Dentro de uma mesma fonte a ordem também informa: os primeiros são os
    // mais relevantes, então o peso decai suavemente ao longo da lista.
    source.candidates.forEach((candidate, index) => {
      if (!isUsable(candidate, input, originIsKids)) return;
      const positionFactor = 1 - Math.min(index, 20) / 40;
      const gain = source.weight * positionFactor;
      const existing = scored.get(candidate.id);
      if (!existing) {
        scored.set(candidate.id, { candidate, score: gain, reason: source.reason });
        return;
      }
      existing.score += gain;
      if (
        REASON_PRIORITY.indexOf(source.reason.key) < REASON_PRIORITY.indexOf(existing.reason.key)
      ) {
        existing.reason = source.reason;
      }
    });
  }

  // A nota entra como bônus/desconto na ordenação para não subir título mal
  // avaliado que por acaso apareceu em duas listas.
  const rank = ({ score, candidate }: Scored) =>
    score + (candidate.voteAverage - RATING_PIVOT) * RATING_WEIGHT;
  const ranked = [...scored.values()].sort((a, b) => rank(b) - rank(a));

  // Cota por motivo: sem ela a lista de "recommendations" do TMDB, que tem o
  // maior peso, preenche as vagas sozinha e as outras fontes nunca aparecem.
  // A cota de ator é contada por ator, para o elenco inteiro não caber nas
  // vagas de um só nome. A segunda passada completa a lista se faltar item.
  const picked: Scored[] = [];
  const usedByReason = new Map<string, number>();
  for (const item of ranked) {
    if (picked.length >= RECOMMENDATION_COUNT) break;
    const quotaKey =
      item.reason.key === 'actor' ? `actor:${item.reason.value}` : item.reason.key;
    const used = usedByReason.get(quotaKey) ?? 0;
    if (used >= REASON_CAPS[item.reason.key]) continue;
    usedByReason.set(quotaKey, used + 1);
    picked.push(item);
  }
  for (const item of ranked) {
    if (picked.length >= RECOMMENDATION_COUNT) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked.map(({ candidate, reason }) => ({
    id: candidate.id,
    title: candidate.title,
    posterPath: candidate.posterPath,
    year: candidate.date ? candidate.date.slice(0, 4) : null,
    voteAverage: candidate.voteAverage,
    reason,
  }));
}
