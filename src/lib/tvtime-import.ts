/**
 * Importação de histórico do app TV Time (original) via CSV do export GDPR.
 *
 * O TV Time não tem API pública. A única forma oficial de tirar os dados de lá
 * é o export de GDPR (https://gdpr.tvtime.com/gdpr/self-service), que gera um
 * arquivo `tracking-prod-records-v2.csv` com uma linha por episódio assistido.
 * O formato das colunas foi confirmado lendo o código-fonte do importador
 * open-source TV Time → Trakt (lukearran/TvTimeToTrakt): `series_name`,
 * `episode_id`, `season_number`, `episode_number`, `created_at`. Linhas que não
 * são episódios (ex. entradas de watchlist) vêm com `episode_number` ou
 * `series_name` vazios.
 */

import { strFromU8, unzipSync } from 'fflate';
import Papa from 'papaparse';

import { searchShows, type TmdbShowSummary } from './tmdb';

const REQUIRED_COLUMNS = ['series_name', 'season_number', 'episode_number'];
const SHOWS_CSV_NAME = 'tracking-prod-records-v2.csv';
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

/**
 * O export de GDPR do TV Time vem como um .zip com dezenas de CSVs — o que
 * interessa pra gente é sempre o `tracking-prod-records-v2.csv`. Se o usuário
 * selecionar o CSV já extraído em vez do zip, os bytes tratamos como texto puro.
 */
export function extractShowsCsvText(bytes: Uint8Array): string {
  const isZip = bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
  if (!isZip) {
    return strFromU8(bytes);
  }

  const entries = unzipSync(bytes, {
    filter: (entry) => entry.name === SHOWS_CSV_NAME,
  });
  const csvBytes = entries[SHOWS_CSV_NAME];
  if (!csvBytes) {
    throw new Error(
      `Não encontramos o arquivo "${SHOWS_CSV_NAME}" dentro do .zip. Confirme se é o export de GDPR do TV Time.`
    );
  }
  return strFromU8(csvBytes);
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

const MATCH_CONCURRENCY = 5;

export async function matchSeriesToTmdb(
  seriesNames: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, TmdbShowSummary[]>> {
  const results = new Map<string, TmdbShowSummary[]>();
  let done = 0;

  for (let i = 0; i < seriesNames.length; i += MATCH_CONCURRENCY) {
    const batch = seriesNames.slice(i, i + MATCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (name) => {
        try {
          const { results: candidates } = await searchShows(name);
          results.set(name, candidates);
        } catch {
          results.set(name, []);
        } finally {
          done += 1;
          onProgress?.(done, seriesNames.length);
        }
      })
    );
  }

  return results;
}
