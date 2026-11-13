/**
 * Datas de estreia dos filmes da lista "Para assistir", na região do usuário.
 *
 * O banco não guarda a data, então ela vem da TMDB — um pedido por filme. A
 * tela inicial, a aba "Em breve" e o agendamento dos avisos perguntam pela
 * mesma lista, então o resultado fica em memória e no aparelho: filme que já
 * estreou nunca mais é consultado, e os que ainda vão estrear são revistos a
 * cada 12h (as distribuidoras mudam a data).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { currentRegion, getMovieRegionalReleaseDate, localToday } from './tmdb';

const STORAGE_KEY = 'movie-release-dates-v1';
const UPCOMING_TTL_MS = 12 * 60 * 60 * 1000;
const BATCH_SIZE = 6;

interface Entry {
  /** YYYY-MM-DD; null = a TMDB ainda não tem data. */
  date: string | null;
  /** Quando foi consultado (ms). */
  at: number;
}

/** `${região}-${tmdb_id}` → entrada. Carregado do aparelho na primeira consulta. */
let entries: Map<string, Entry> | null = null;
let loading: Promise<Map<string, Entry>> | null = null;

function loadEntries() {
  if (entries) return Promise.resolve(entries);
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => new Map<string, Entry>(raw ? Object.entries(JSON.parse(raw)) : []))
    .catch(() => new Map<string, Entry>())
    .then((loaded) => {
      entries = loaded;
      return loaded;
    });
  return loading;
}

function isFresh(entry: Entry | undefined, today: string) {
  if (!entry) return false;
  // Já estreou: a data não muda mais.
  if (entry.date && entry.date < today) return true;
  return Date.now() - entry.at < UPCOMING_TTL_MS;
}

/**
 * Data de estreia de cada filme pedido. Filme cuja consulta falhou fica de
 * fora do resultado (e é tentado de novo na próxima chamada).
 */
export async function getMovieReleaseDates(
  movieIds: number[]
): Promise<Record<number, string | null>> {
  const cache = await loadEntries();
  const region = currentRegion();
  const today = localToday();
  const result: Record<number, string | null> = {};
  const missing: number[] = [];

  for (const id of movieIds) {
    const entry = cache.get(`${region}-${id}`);
    if (entry && isFresh(entry, today)) result[id] = entry.date;
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    await Promise.all(
      missing.slice(i, i + BATCH_SIZE).map(async (id) => {
        try {
          const date = await getMovieRegionalReleaseDate(id);
          cache.set(`${region}-${id}`, { date, at: Date.now() });
          result[id] = date;
        } catch {
          // Sem rede: se havia uma data antiga guardada, ela ainda serve.
          const stale = cache.get(`${region}-${id}`);
          if (stale) result[id] = stale.date;
        }
      })
    );
  }

  if (missing.length > 0) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache))).catch(() => {});
  }
  return result;
}
