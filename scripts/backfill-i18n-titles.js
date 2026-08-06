#!/usr/bin/env node

/**
 * Preenche name_en/title_en nas 4 tabelas que denormalizam nome de série ou
 * filme (ver supabase/schema.sql: followed_shows, watched_movies,
 * favorites, watchlist_movies) para os registros criados antes da
 * internacionalização do app — hoje só têm o nome em pt-BR gravado.
 *
 * Busca o nome em inglês de cada tmdb_id na TMDB e faz UPDATE só da coluna
 * "_en" (nunca mexe no nome em pt-BR já salvo). Idempotente: só olha linhas
 * com a coluna "_en" ainda nula, então pode ser rodado de novo com
 * segurança se parar no meio ou se algum título falhar.
 *
 * ATENÇÃO: usa a service_role key, que bypassa RLS — necessário para
 * atualizar linhas de todos os usuários, não só as suas. Nunca comite essa
 * chave. Pegue em Project Settings > API no painel do Supabase.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/backfill-i18n-titles.js
 *   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/backfill-i18n-titles.js --dry-run
 *
 * Reaproveita do .env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_TMDB_API_KEY.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

const DRY_RUN = process.argv.includes('--dry-run');
// Evita rajada de requisições à TMDB (mesmo limite usado no casamento com a
// TMDB durante o import do TV Time, ver MATCH_CONCURRENCY em tvtime-import.ts).
const CONCURRENCY = 5;
const PAGE_SIZE = 500;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TMDB_API_KEY) {
  console.error(
    'Faltam variáveis de ambiente: EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e ' +
      'EXPO_PUBLIC_TMDB_API_KEY são todas obrigatórias (as duas primeiras já devem estar no ' +
      '.env; SUPABASE_SERVICE_ROLE_KEY passe na hora de rodar, não a salve no .env).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const isV4Token = TMDB_API_KEY.startsWith('eyJ');

async function fetchEnglishName(media, tmdbId) {
  const url = new URL(`${TMDB_BASE}/${media}/${tmdbId}`);
  url.searchParams.set('language', 'en-US');
  if (!isV4Token) url.searchParams.set('api_key', TMDB_API_KEY);
  const response = await fetch(url, {
    headers: isV4Token ? { Authorization: `Bearer ${TMDB_API_KEY}` } : undefined,
  });
  if (!response.ok) return null;
  const data = await response.json();
  return (media === 'movie' ? data.title : data.name) || null;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    batchResults.forEach((result, j) => {
      results[i + j] = result;
    });
  }
  return results;
}

/** Cache por tmdb_id: vários usuários costumam ter o mesmo título salvo. */
function createNameFetcher(media) {
  const cache = new Map();
  return function getName(tmdbId) {
    if (!cache.has(tmdbId)) {
      cache.set(
        tmdbId,
        fetchEnglishName(media, tmdbId).catch(() => null)
      );
    }
    return cache.get(tmdbId);
  };
}

async function backfillTable({ table, enColumn, media, mediaFromRow }) {
  console.log(`\n--- ${table} ---`);
  const getNameFor = mediaFromRow
    ? { tv: createNameFetcher('tv'), movie: createNameFetcher('movie') }
    : createNameFetcher(media);

  let updated = 0;
  let failed = 0;

  for (;;) {
    const columns = mediaFromRow ? 'user_id, tmdb_id, media_type' : 'user_id, tmdb_id';
    const { data: rows, error } = await supabase
      .from(table)
      .select(columns)
      .is(enColumn, null)
      .limit(PAGE_SIZE);
    if (error) throw error;
    if (!rows || rows.length === 0) break;

    const names = await mapWithConcurrency(rows, CONCURRENCY, (row) => {
      const fetcher = mediaFromRow ? getNameFor[row.media_type] : getNameFor;
      return fetcher(row.tmdb_id);
    });

    let updatedThisBatch = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = names[i];
      if (!name) {
        failed += 1;
        continue;
      }
      if (DRY_RUN) {
        updatedThisBatch += 1;
        continue;
      }
      let query = supabase.from(table).update({ [enColumn]: name }).eq('user_id', row.user_id).eq('tmdb_id', row.tmdb_id);
      if (mediaFromRow) query = query.eq('media_type', row.media_type);
      const { error: updateError } = await query;
      if (updateError) throw updateError;
      updatedThisBatch += 1;
    }
    updated += updatedThisBatch;
    console.log(`  ${updated} preenchidos até agora (${failed} sem nome na TMDB)...`);

    // Sem updates nesta rodada (tudo falhou ou é dry-run) — sai para não girar
    // para sempre reconsultando as mesmas linhas.
    if (updatedThisBatch === 0 || DRY_RUN) break;
  }

  console.log(
    `  ✅ ${table}: ${updated} registro(s) ${DRY_RUN ? 'seriam preenchidos' : 'preenchidos'}` +
      (failed > 0 ? `, ${failed} sem nome em inglês na TMDB (título removido/indisponível).` : '.')
  );
}

async function main() {
  if (DRY_RUN) console.log('Modo --dry-run: só mostra o que seria atualizado, sem gravar nada.\n');

  await backfillTable({ table: 'followed_shows', enColumn: 'name_en', media: 'tv' });
  await backfillTable({ table: 'watched_movies', enColumn: 'title_en', media: 'movie' });
  await backfillTable({ table: 'watchlist_movies', enColumn: 'title_en', media: 'movie' });
  await backfillTable({ table: 'favorites', enColumn: 'title_en', mediaFromRow: true });

  console.log('\nBackfill concluído.');
}

main().catch((err) => {
  console.error('\nErro no backfill:', err);
  process.exit(1);
});
