/**
 * "Assistir a seguir" (estilo TV Time): para cada série seguida, qual é o
 * primeiro episódio já exibido que o usuário ainda não assistiu.
 */

import { getWatchedEpisodes } from './db';
import { getSeasonDetailsCached, getShowDetailsCached } from './tmdb';

export interface NextEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  stillPath: string | null;
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

  for (const season of seasons) {
    const watchedInSeason = watchedPerSeason.get(season.season_number) ?? 0;
    if (season.episode_count > 0 && watchedInSeason >= season.episode_count) continue;
    // Temporada que ainda nem estreou: nada exibido para assistir.
    if (season.air_date && season.air_date > today) return null;

    const seasonDetails = await getSeasonDetailsCached(showId, season.season_number);
    const next = seasonDetails.episodes.find(
      (episode) =>
        episode.air_date !== null &&
        episode.air_date <= today &&
        !watchedSet.has(`${episode.season_number}-${episode.episode_number}`)
    );
    if (next) {
      return {
        seasonNumber: next.season_number,
        episodeNumber: next.episode_number,
        name: next.name || null,
        stillPath: next.still_path,
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
