#!/usr/bin/env node

/**
 * Resolve nome (pt-BR) de tmdb_id na TMDB, para os casos em que uma query
 * SQL no watched_episodes/watched_movies traz "nome" NULL (a série/filme foi
 * marcado como assistido sem nunca ter sido seguido nem favoritado, então
 * não sobra nome em nenhuma tabela do banco — ver followed_shows/favorites
 * em supabase/schema.sql).
 *
 * Só lê a TMDB, não toca no Supabase.
 *
 * Uso:
 *   node scripts/tmdb-lookup.js tv 2734 5834
 *   node scripts/tmdb-lookup.js movie 129 550
 */

require('dotenv').config();

const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  console.error('Falta EXPO_PUBLIC_TMDB_API_KEY no .env.');
  process.exit(1);
}

const isV4Token = TMDB_API_KEY.startsWith('eyJ');
const [media, ...ids] = process.argv.slice(2);

if ((media !== 'tv' && media !== 'movie') || ids.length === 0) {
  console.error('Uso: node scripts/tmdb-lookup.js <tv|movie> <id> [id...]');
  process.exit(1);
}

async function lookup(tmdbId) {
  const url = new URL(`${TMDB_BASE}/${media}/${tmdbId}`);
  url.searchParams.set('language', 'pt-BR');
  if (!isV4Token) url.searchParams.set('api_key', TMDB_API_KEY);
  const response = await fetch(url, {
    headers: isV4Token ? { Authorization: `Bearer ${TMDB_API_KEY}` } : undefined,
  });
  if (!response.ok) return { tmdbId, name: null, status: response.status };
  const data = await response.json();
  return { tmdbId, name: (media === 'movie' ? data.title : data.name) || null };
}

async function main() {
  const results = await Promise.all(ids.map(lookup));
  for (const { tmdbId, name, status } of results) {
    console.log(name ? `${tmdbId}\t${name}` : `${tmdbId}\t(não encontrado na TMDB, status ${status})`);
  }
}

main();
