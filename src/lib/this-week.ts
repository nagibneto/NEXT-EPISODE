/**
 * Faixa "Próximos" (aba Início e topo da Watchlist): o que estreia nos
 * próximos dias entre as séries seguidas e os filmes da lista "Para assistir".
 */

import type { TFunction } from 'i18next';

import type { FollowedShow, WatchlistMovie } from './db';
import { localizedTitle } from './locale';
import { localToday } from './tmdb';

/** Próximo episódio anunciado de uma série (ainda não exibido). */
export interface NextAiring {
  airDate: string;
  seasonNumber: number;
  episodeNumber: number;
}

export interface ThisWeekItem {
  media: 'tv' | 'movie';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  /** Dia da estreia (YYYY-MM-DD). */
  date: string;
  /** Linha de baixo: "T02 | E05" ou "Estreia do filme". */
  detail: string;
}

/** Quantos dias à frente a faixa enxerga. */
export const THIS_WEEK_DAYS = 7;

/** Itens da faixa, de hoje até daqui a THIS_WEEK_DAYS dias, em ordem de data. */
export function buildThisWeekItems({
  shows,
  nextAirById,
  movies,
  movieReleaseById,
  language,
  t,
}: {
  shows: FollowedShow[];
  nextAirById: Record<number, NextAiring | null | undefined>;
  movies: WatchlistMovie[];
  movieReleaseById: Record<number, string | null | undefined>;
  language: string;
  t: TFunction;
}): ThisWeekItem[] {
  const today = localToday();
  const limit = localToday(THIS_WEEK_DAYS);
  const inWindow = (date: string | null | undefined): date is string =>
    !!date && date >= today && date <= limit;

  const items: ThisWeekItem[] = [];
  for (const show of shows) {
    const next = nextAirById[show.tmdb_id];
    if (!next || !inWindow(next.airDate)) continue;
    items.push({
      media: 'tv',
      tmdbId: show.tmdb_id,
      title: localizedTitle(show.name, show.name_en, language),
      posterPath: show.poster_path,
      date: next.airDate,
      detail: t('home.seasonEpisodeCompact', {
        season: String(next.seasonNumber).padStart(2, '0'),
        episode: String(next.episodeNumber).padStart(2, '0'),
      }),
    });
  }
  for (const movie of movies) {
    const date = movieReleaseById[movie.tmdb_id];
    if (!inWindow(date)) continue;
    items.push({
      media: 'movie',
      tmdbId: movie.tmdb_id,
      title: localizedTitle(movie.title, movie.title_en, language),
      posterPath: movie.poster_path,
      date,
      detail: t('home.thisWeekMovie'),
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
