/**
 * "Assistir a seguir" (estilo TV Time): para cada série seguida, qual é o
 * primeiro episódio já exibido que o usuário ainda não assistiu.
 */

import { getWatchedEpisodes, markSeasonWatched } from './db';
import { airedEpisodesInSeason, getSeasonDetailsCached, getShowDetailsCached } from './tmdb';

export interface NextEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  stillPath: string | null;
  /**
   * Quantos episódios já exibidos o usuário ainda não viu, contando este.
   * Ausente em entradas gravadas no cache por versões anteriores do app.
   */
  availableCount?: number;
}

/**
 * Varre as temporadas em ordem e devolve o primeiro episódio exibido não
 * assistido, ou null quando o usuário está em dia. Para economizar chamadas à
 * TMDB, temporadas com todos os episódios assistidos (contagem bate com o
 * episode_count da série) são puladas sem buscar os detalhes — no caso comum
 * só a temporada "atual" do usuário é consultada.
 */
export async function getNextUnwatchedEpisode(
  userId: string,
  showId: number
): Promise<NextEpisode | null> {
  const [details, watched] = await Promise.all([
    getShowDetailsCached(showId),
    getWatchedEpisodes(userId, showId),
  ]);

  const watchedSet = new Set(watched.map((e) => `${e.season_number}-${e.episode_number}`));
  const watchedPerSeason = new Map<number, number>();
  for (const episode of watched) {
    watchedPerSeason.set(
      episode.season_number,
      (watchedPerSeason.get(episode.season_number) ?? 0) + 1
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const seasons = details.seasons
    .filter((season) => season.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);

  const isAiredUnwatched = (episode: {
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }) =>
    episode.air_date !== null &&
    episode.air_date <= today &&
    !watchedSet.has(`${episode.season_number}-${episode.episode_number}`);

  for (const [index, season] of seasons.entries()) {
    const watchedInSeason = watchedPerSeason.get(season.season_number) ?? 0;
    if (season.episode_count > 0 && watchedInSeason >= season.episode_count) continue;
    // Temporada que ainda nem estreou: nada exibido para assistir.
    if (season.air_date && season.air_date > today) return null;

    const seasonDetails = await getSeasonDetailsCached(showId, season.season_number);
    const next = seasonDetails.episodes.find(isAiredUnwatched);
    if (next) {
      // Selo "N disponíveis": conta episódio por episódio em vez de subtrair
      // totais (exibidos − assistidos). A subtração errava sempre que os dois
      // lados não falavam da mesma coisa — especial (temporada 0) marcado como
      // visto, ou o último episódio exibido da TMDB ainda desatualizado.
      let availableCount = seasonDetails.episodes.filter(isAiredUnwatched).length;
      const lastAired = details.last_episode_to_air;
      for (const later of seasons.slice(index + 1)) {
        if (later.air_date && later.air_date > today) break;
        const watchedInLater = watchedPerSeason.get(later.season_number) ?? 0;
        let availableInLater = Math.max(airedEpisodesInSeason(details, later) - watchedInLater, 0);
        // Temporada já encerrada: a conta acima basta e poupa uma chamada à
        // TMDB. Na que ainda está no ar, só a data de cada episódio é confiável.
        if (lastAired && later.season_number >= lastAired.season_number) {
          try {
            const laterDetails = await getSeasonDetailsCached(showId, later.season_number);
            availableInLater = laterDetails.episodes.filter(isAiredUnwatched).length;
          } catch {
            // Fica com a estimativa: errar o selo é melhor que perder o card.
          }
        }
        availableCount += availableInLater;
      }
      return {
        seasonNumber: next.season_number,
        episodeNumber: next.episode_number,
        name: next.name || null,
        stillPath: next.still_path,
        availableCount,
      };
    }
    // Tudo que foi ao ar nesta temporada já foi visto; se o resto ainda não
    // estreou, o usuário está em dia. Senão, segue para a próxima temporada.
    const hasUnaired = seasonDetails.episodes.some(
      (episode) => !episode.air_date || episode.air_date > today
    );
    if (hasUnaired) return null;
  }

  return null;
}

export interface SkippedEpisode {
  seasonNumber: number;
  episodeNumber: number;
}

/**
 * Episódios já exibidos, anteriores ao (temporada, episódio) informado, que
 * o usuário ainda não marcou como assistidos. Usado para avisar quando ele
 * marca um episódio avançado e "pula" episódios pra trás.
 */
export async function getSkippedEpisodes(
  userId: string,
  showId: number,
  beforeSeasonNumber: number,
  beforeEpisodeNumber: number
): Promise<SkippedEpisode[]> {
  const [details, watched] = await Promise.all([
    getShowDetailsCached(showId),
    getWatchedEpisodes(userId, showId),
  ]);

  const watchedSet = new Set(watched.map((e) => `${e.season_number}-${e.episode_number}`));
  const today = new Date().toISOString().slice(0, 10);
  const seasons = details.seasons
    .filter((season) => season.season_number > 0 && season.season_number <= beforeSeasonNumber)
    .sort((a, b) => a.season_number - b.season_number);

  const skipped: SkippedEpisode[] = [];
  for (const season of seasons) {
    const seasonDetails = await getSeasonDetailsCached(showId, season.season_number);
    for (const episode of seasonDetails.episodes) {
      if (season.season_number === beforeSeasonNumber && episode.episode_number >= beforeEpisodeNumber) {
        continue;
      }
      if (!episode.air_date || episode.air_date > today) continue;
      if (watchedSet.has(`${episode.season_number}-${episode.episode_number}`)) continue;
      skipped.push({ seasonNumber: episode.season_number, episodeNumber: episode.episode_number });
    }
  }
  return skipped;
}

/** Marca em lote os episódios pulados devolvidos por getSkippedEpisodes, agrupando por temporada. */
export async function markSkippedEpisodesWatched(
  userId: string,
  showId: number,
  skipped: SkippedEpisode[]
) {
  const bySeason = new Map<number, number[]>();
  for (const episode of skipped) {
    const list = bySeason.get(episode.seasonNumber) ?? [];
    list.push(episode.episodeNumber);
    bySeason.set(episode.seasonNumber, list);
  }
  await Promise.all(
    Array.from(bySeason.entries()).map(([season, episodeNumbers]) =>
      markSeasonWatched(userId, showId, season, episodeNumbers)
    )
  );
}
