/**
 * Importação de histórico do app TV Time (original) via CSV do export GDPR.
 *
 * O TV Time não tem API pública. A única forma oficial de tirar os dados de lá
 * é o export de GDPR (https://gdpr.tvtime.com/gdpr/self-service), que gera um
 * zip com dezenas de CSVs. Os episódios assistidos vêm no
 * `tracking-prod-records-v2.csv` (uma linha por episódio) e os filmes no
 * `tracking-prod-records.csv` (linhas com `entity_type=movie`).
 * O formato das colunas foi confirmado lendo o código-fonte do importador
 * open-source TV Time → Trakt (lukearran/TvTimeToTrakt): `series_name`,
 * `episode_id`, `season_number`, `episode_number`, `created_at`. Linhas que não
 * são episódios (ex. entradas de watchlist) vêm com `episode_number` ou
 * `series_name` vazios.
 */

import { strFromU8, unzipSync } from 'fflate';
import Papa from 'papaparse';

import { searchMovies, searchShows, type TmdbMovieSummary, type TmdbShowSummary } from './tmdb';

const REQUIRED_COLUMNS = ['series_name', 'season_number', 'episode_number'];
const SHOWS_CSV_NAME = 'tracking-prod-records-v2.csv';
const MOVIES_CSV_NAME = 'tracking-prod-records.csv';
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

export interface TvTimeCsvFiles {
  showsCsv: string;
  /** null quando o usuário selecionou só o CSV de episódios em vez do zip. */
  moviesCsv: string | null;
}

/**
 * O export de GDPR do TV Time vem como um .zip com dezenas de CSVs — o que
 * interessa pra gente são o `tracking-prod-records-v2.csv` (episódios) e o
 * `tracking-prod-records.csv` (filmes). Se o usuário selecionar o CSV já
 * extraído em vez do zip, os bytes tratamos como texto puro (só episódios).
 */
export function extractTvTimeCsvs(bytes: Uint8Array): TvTimeCsvFiles {
  const isZip = bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
  if (!isZip) {
    return { showsCsv: strFromU8(bytes), moviesCsv: null };
  }

  const entries = unzipSync(bytes, {
    filter: (entry) => entry.name === SHOWS_CSV_NAME || entry.name === MOVIES_CSV_NAME,
  });
  const csvBytes = entries[SHOWS_CSV_NAME];
  if (!csvBytes) {
    throw new Error(
      `Não encontramos o arquivo "${SHOWS_CSV_NAME}" dentro do .zip. Confirme se é o export de GDPR do TV Time.`
    );
  }
  const moviesBytes = entries[MOVIES_CSV_NAME];
  return {
    showsCsv: strFromU8(csvBytes),
    moviesCsv: moviesBytes ? strFromU8(moviesBytes) : null,
  };
}

export interface TvTimeEpisodeRow {
  seriesName: string;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string | null;
}

export interface TvTimeSeriesGroup {
  seriesName: string;
  episodes: TvTimeEpisodeRow[];
}

function parseTvTimeDate(value: string | undefined): string | null {
  if (!value) return null;
  const isoLike = value.includes(' ') ? value.replace(' ', 'T') : value;
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseTvTimeShowsCsv(csvText: string): TvTimeEpisodeRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const columns = parsed.meta.fields ?? [];
  const hasRequiredColumns = REQUIRED_COLUMNS.every((column) => columns.includes(column));
  if (!hasRequiredColumns) {
    throw new Error(
      'Esse arquivo não parece ser o CSV de séries do TV Time. Selecione o arquivo "tracking-prod-records-v2.csv" do seu export.'
    );
  }

  const rows: TvTimeEpisodeRow[] = [];
  for (const row of parsed.data) {
    const seriesName = row.series_name?.trim();
    const episodeNumber = Number(row.episode_number);
    const seasonNumber = Number(row.season_number);
    if (!seriesName || !row.episode_number || Number.isNaN(episodeNumber) || Number.isNaN(seasonNumber)) {
      continue;
    }
    rows.push({
      seriesName,
      seasonNumber,
      episodeNumber,
      watchedAt: parseTvTimeDate(row.created_at),
    });
  }
  return rows;
}

/**
 * O CSV do TV Time tem uma linha por "watch-episode" e outra por
 * "rewatch-episode" — o mesmo episódio pode aparecer várias vezes. Como
 * `watched_episodes` tem uma linha só por episódio, mantemos apenas a
 * ocorrência mais recente de cada (temporada, episódio) pra não mandar a
 * mesma chave duas vezes num único upsert (o Postgres rejeita isso com
 * "ON CONFLICT DO UPDATE command cannot affect row a second time").
 */
export function dedupeEpisodes(episodes: TvTimeEpisodeRow[]): TvTimeEpisodeRow[] {
  const byKey = new Map<string, TvTimeEpisodeRow>();
  for (const episode of episodes) {
    const key = `${episode.seasonNumber}-${episode.episodeNumber}`;
    const existing = byKey.get(key);
    if (!existing || (episode.watchedAt ?? '') > (existing.watchedAt ?? '')) {
      byKey.set(key, episode);
    }
  }
  return Array.from(byKey.values());
}

export function groupBySeries(rows: TvTimeEpisodeRow[]): TvTimeSeriesGroup[] {
  const groups = new Map<string, TvTimeEpisodeRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.seriesName);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.seriesName, [row]);
    }
  }
  return Array.from(groups.entries()).map(([seriesName, episodes]) => ({
    seriesName,
    episodes: dedupeEpisodes(episodes),
  }));
}

// ---------- Filmes ----------

export interface TvTimeMovieRow {
  movieName: string;
  watchedAt: string | null;
}

/**
 * Filmes assistidos vêm do `tracking-prod-records.csv` (formato antigo do TV
 * Time): linhas com `type=watch` e `entity_type=movie`, nome em `movie_name`.
 * O mesmo filme pode aparecer de novo como `type=rewatch` — mantemos a
 * ocorrência mais recente de cada nome. Se o CSV não tiver as colunas
 * esperadas, devolve lista vazia (filmes são um extra da importação, não
 * podem travar a de episódios).
 */
export function parseTvTimeMoviesCsv(csvText: string): TvTimeMovieRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const columns = parsed.meta.fields ?? [];
  if (!['type', 'entity_type', 'movie_name'].every((column) => columns.includes(column))) {
    return [];
  }

  const byName = new Map<string, TvTimeMovieRow>();
  for (const row of parsed.data) {
    const movieName = row.movie_name?.trim();
    const isWatch = row.type === 'watch' || row.type === 'rewatch';
    if (!movieName || !isWatch || row.entity_type !== 'movie') continue;
    const watchedAt = parseTvTimeDate(row.created_at);
    const existing = byName.get(movieName);
    if (!existing || (watchedAt ?? '') > (existing.watchedAt ?? '')) {
      byName.set(movieName, { movieName, watchedAt });
    }
  }
  return Array.from(byName.values());
}

// ---------- Match no TMDB ----------

const MATCH_CONCURRENCY = 5;

/** Sufixo de ano que o TV Time acrescenta a alguns títulos: "Titans (2018)". */
const YEAR_SUFFIX_RE = /\s*\((\d{4})\)\s*$/;
/** Qualquer sufixo entre parênteses, incluindo país: "Kitchen Nightmares (BR)". */
const PAREN_SUFFIX_RE = /\s*\([^)]*\)\s*$/;

/**
 * A busca do TMDB não reconhece os sufixos que o TV Time põe no nome —
 * "Titans (2018)" ou "Kitchen Nightmares (BR)" voltam vazios. Quando o nome
 * cru não acha nada, tenta de novo sem o parêntese final (usando o ano como
 * filtro quando o sufixo era um ano) e, por último, só o nome limpo.
 */
async function searchWithFallbacks<T>(
  name: string,
  search: (query: string, year?: number) => Promise<{ results: T[] }>
): Promise<T[]> {
  const { results } = await search(name);
  if (results.length > 0) return results;

  const cleaned = name.replace(PAREN_SUFFIX_RE, '').trim();
  if (!cleaned || cleaned === name) return results;

  const yearMatch = YEAR_SUFFIX_RE.exec(name);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  const { results: cleanedResults } = await search(cleaned, year);
  if (cleanedResults.length > 0 || !year) return cleanedResults;

  const { results: noYearResults } = await search(cleaned);
  return noYearResults;
}

async function matchNamesToTmdb<T>(
  names: string[],
  search: (query: string, year?: number) => Promise<{ results: T[] }>,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, T[]>> {
  const results = new Map<string, T[]>();
  let done = 0;

  for (let i = 0; i < names.length; i += MATCH_CONCURRENCY) {
    const batch = names.slice(i, i + MATCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (name) => {
        try {
          results.set(name, await searchWithFallbacks(name, search));
        } catch {
          results.set(name, []);
        } finally {
          done += 1;
          onProgress?.(done, names.length);
        }
      })
    );
  }

  return results;
}

export function matchSeriesToTmdb(
  seriesNames: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, TmdbShowSummary[]>> {
  return matchNamesToTmdb(seriesNames, (query, year) => searchShows(query, 1, year), onProgress);
}

export function matchMoviesToTmdb(
  movieNames: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, TmdbMovieSummary[]>> {
  return matchNamesToTmdb(movieNames, (query, year) => searchMovies(query, 1, year), onProgress);
}
