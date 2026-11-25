/**
 * Edge Function: proxy da API da IGDB (https://api-docs.igdb.com) para a aba
 * Games.
 *
 * Por que um proxy: a IGDB autentica com o Client ID + Client Secret de um app
 * da Twitch (OAuth client_credentials). O secret não pode ir dentro do app, e
 * o token que ele gera vale ~60 dias para qualquer um que o tenha. Aqui ele
 * fica só no servidor, e o app manda apenas ações fechadas (busca, listas e
 * detalhe) — nunca uma query Apicalypse livre.
 *
 * Corpo (POST, JSON):
 *   { action: 'search', query: string }
 *   { action: 'list', list: 'trending' | 'upcoming' | 'recent' | 'top' }
 *   { action: 'details', id: number }
 *   { action: 'steamLookup', appIds: number[] }   (appId da Steam → jogo da IGDB)
 *   { action: 'matchNames', names: string[] }     (nome → jogo da IGDB, ex.: troféus da PSN)
 * Resposta: { games: GameSummary[] }, { game: GameDetails } ou
 * { matches: { appId, game }[] }.
 *
 * Secrets (Dashboard → Edge Functions → Secrets, ou `supabase secrets set`):
 *   TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
 *
 * Deploy:
 *   supabase functions deploy igdb
 * (mantém a verificação de JWT ligada — sem --no-verify-jwt)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { nameMatchScore } from '../_shared/names.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') ?? '';

const IGDB_URL = 'https://api.igdb.com/v4';

// Tipos de jogo da IGDB (endpoint game_types): 0 jogo principal, 1 DLC,
// 2 expansão, 4 expansão standalone, 8 remake, 9 remaster, 10 edição
// expandida, 11 port. Ficam de fora bundles, mods, episódios, packs e updates.
const LIST_GAME_TYPES = '(0,4,8,9,10)';
const SEARCH_GAME_TYPES = '(0,1,2,4,8,9,10,11)';

const BASE_FIELDS =
  'name, cover.image_id, first_release_date, total_rating, total_rating_count, platforms.abbreviation';
// `themes` (só os ids) vai junto para filtrar jogos eróticos (ver isAdult).
const SUMMARY_FIELDS = `${BASE_FIELDS}, themes`;

const DETAILS_FIELDS = [
  BASE_FIELDS,
  'summary',
  'storyline',
  'genres.name',
  'themes.name',
  'platforms.name',
  'involved_companies.company.name',
  'involved_companies.developer',
  'involved_companies.publisher',
  'screenshots.image_id',
  'artworks.image_id',
  'videos.video_id',
  'videos.name',
  'similar_games.name',
  'similar_games.cover.image_id',
  'similar_games.first_release_date',
  'similar_games.total_rating',
  'similar_games.total_rating_count',
  'similar_games.platforms.abbreviation',
  'similar_games.themes',
  'url',
].join(', ');

// ---------- Token da Twitch ----------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Twitch respondeu ${res.status} ao gerar o token.`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  // Renova um dia antes de vencer, para nunca usar um token no limite.
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(body.expires_in - 86_400, 60) * 1000,
  };
  return cachedToken.value;
}

/**
 * Chama um endpoint da IGDB com uma query Apicalypse. Trata os dois erros que
 * acontecem na prática: token revogado/expirado (401 → gera outro) e o limite
 * de 4 requisições por segundo (429 → espera um pouco e tenta de novo).
 */
async function igdb<T>(endpoint: string, query: string, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: query,
  });
  if ((res.status === 401 || res.status === 429) && attempt < 2) {
    if (res.status === 401) cachedToken = null;
    else await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    return igdb<T>(endpoint, query, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IGDB respondeu ${res.status} em /${endpoint}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------- Cache em memória ----------
// A instância da function vive alguns minutos entre chamadas; enquanto vive,
// listas e detalhes repetidos não gastam requisição da IGDB.

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const LIST_TTL = 30 * 60 * 1000;
const DETAILS_TTL = 6 * 60 * 60 * 1000;
const SEARCH_TTL = 10 * 60 * 1000;

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  if (cache.size > 500) cache.clear();
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  return value;
}

// ---------- Normalização ----------
// O app recebe um formato enxuto e estável, sem depender dos nomes da IGDB.

interface RawGame {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  total_rating?: number;
  total_rating_count?: number;
  platforms?: { abbreviation?: string; name?: string }[];
  summary?: string;
  storyline?: string;
  genres?: { name: string }[];
  /** Ids (listas) ou objetos com nome (detalhe, via themes.name). */
  themes?: (number | { id: number; name?: string })[];
  involved_companies?: { company?: { name: string }; developer: boolean; publisher: boolean }[];
  screenshots?: { image_id: string }[];
  artworks?: { image_id: string }[];
  videos?: { video_id: string; name?: string }[];
  similar_games?: RawGame[];
  url?: string;
}

// Tema 42 da IGDB = "Erotic". Esses jogos (muitos com capa explícita) ficam
// fora de tudo que o app mostra: a App Store proíbe conteúdo sexual explícito
// (regra 1.1.4), mesmo com a classificação 16+.
const EROTIC_THEME_ID = 42;

function isAdult(game: RawGame) {
  return (game.themes ?? []).some(
    (theme) => (typeof theme === 'number' ? theme : theme.id) === EROTIC_THEME_ID
  );
}

const notAdult = (game: RawGame) => !isAdult(game);

function toSummary(game: RawGame) {
  return {
    id: game.id,
    name: game.name,
    coverId: game.cover?.image_id ?? null,
    releaseDate: game.first_release_date ?? null,
    rating: game.total_rating ?? null,
    ratingCount: game.total_rating_count ?? 0,
    platforms: (game.platforms ?? [])
      .map((p) => p.abbreviation)
      .filter((p): p is string => Boolean(p)),
  };
}

function toDetails(game: RawGame, timeToBeat: TimeToBeat | null, steamAppId: number | null) {
  const companies = game.involved_companies ?? [];
  const companyNames = (filter: (c: (typeof companies)[number]) => boolean) =>
    Array.from(new Set(companies.filter(filter).map((c) => c.company?.name).filter(Boolean)));
  return {
    ...toSummary(game),
    summary: game.summary ?? null,
    storyline: game.storyline ?? null,
    genres: (game.genres ?? []).map((g) => g.name),
    themes: (game.themes ?? [])
      .map((t) => (typeof t === 'number' ? null : (t.name ?? null)))
      .filter((name): name is string => Boolean(name)),
    platformNames: (game.platforms ?? []).map((p) => p.name).filter(Boolean),
    developers: companyNames((c) => c.developer),
    publishers: companyNames((c) => c.publisher),
    screenshots: (game.screenshots ?? []).map((s) => s.image_id),
    artworks: (game.artworks ?? []).map((a) => a.image_id),
    videos: (game.videos ?? []).map((v) => ({ id: v.video_id, name: v.name ?? null })),
    similar: (game.similar_games ?? []).filter((g) => g.cover && notAdult(g)).map(toSummary),
    timeToBeat,
    /** appId do jogo na Steam (para as conquistas); null = não está na Steam. */
    steamAppId,
    url: game.url ?? null,
  };
}

interface TimeToBeat {
  /** Segundos: só a história, correndo / história normal / 100%. */
  hastily: number | null;
  normally: number | null;
  completely: number | null;
}

// ---------- Ações ----------

/** Busca por nome. Aspas e barras saem para não quebrar a query Apicalypse. */
async function search(rawQuery: string) {
  const query = rawQuery.replace(/["\\]/g, ' ').trim().slice(0, 100);
  if (query.length < 2) return [];
  return cached(`search:${query.toLowerCase()}`, SEARCH_TTL, async () => {
    const rows = await igdb<RawGame[]>(
      'games',
      `search "${query}"; fields ${SUMMARY_FIELDS}; ` +
        `where version_parent = null & game_type = ${SEARCH_GAME_TYPES}; limit 40;`
    );
    return rows.filter(notAdult).map(toSummary);
  });
}

type ListName = 'trending' | 'upcoming' | 'recent' | 'top';

async function list(name: ListName) {
  return cached(`list:${name}`, LIST_TTL, async () => {
    const now = Math.floor(Date.now() / 1000);
    const base = `fields ${SUMMARY_FIELDS}; limit 30;`;
    const common = `cover != null & game_type = ${LIST_GAME_TYPES}`;

    if (name === 'trending') {
      // "Em alta" de verdade vem das métricas de popularidade da IGDB
      // (popularity_type 1 = visitas na IGDB). Se o endpoint falhar, cai para
      // os lançamentos dos últimos meses mais comentados.
      try {
        const popular = await igdb<{ game_id: number }[]>(
          'popularity_primitives',
          'fields game_id, value; where popularity_type = 1; sort value desc; limit 40;'
        );
        const ids = popular.map((p) => p.game_id);
        if (ids.length > 0) {
          const rows = await igdb<RawGame[]>(
            'games',
            `fields ${SUMMARY_FIELDS}; where id = (${ids.join(',')}) & ${common}; limit 40;`
          );
          const byId = new Map(rows.map((r) => [r.id, r]));
          const ordered = ids.map((id) => byId.get(id)).filter((g): g is RawGame => Boolean(g));
          if (ordered.length >= 5) return ordered.filter(notAdult).slice(0, 30).map(toSummary);
        }
      } catch (err) {
        console.warn('popularity_primitives falhou, usando fallback', err);
      }
      const rows = await igdb<RawGame[]>(
        'games',
        `${base} where ${common} & first_release_date > ${now - 180 * 86_400} & ` +
          `first_release_date <= ${now} & total_rating_count > 0; sort total_rating_count desc;`
      );
      return rows.filter(notAdult).map(toSummary);
    }

    if (name === 'upcoming') {
      const rows = await igdb<RawGame[]>(
        'games',
        `${base} where ${common} & first_release_date > ${now} & hypes > 0; sort hypes desc;`
      );
      return rows.filter(notAdult).map(toSummary);
    }

    if (name === 'recent') {
      const rows = await igdb<RawGame[]>(
        'games',
        `${base} where ${common} & first_release_date > ${now - 60 * 86_400} & ` +
          `first_release_date <= ${now} & (hypes > 2 | total_rating_count > 2); ` +
          `sort first_release_date desc;`
      );
      return rows.filter(notAdult).map(toSummary);
    }

    // top: aclamados com bastante avaliação, para não premiar nota de 3 votos.
    const rows = await igdb<RawGame[]>(
      'games',
      `${base} where ${common} & total_rating_count > 400; sort total_rating desc;`
    );
    return rows.filter(notAdult).map(toSummary);
  });
}

// ---------- Steam (external_games) ----------
// Fonte 1 = Steam. A IGDB trocou o campo `category` por
// `external_game_source` em 2025; tenta o novo e cai para o antigo.

interface RawExternalGame {
  uid: string;
  game?: RawGame | number;
}

async function externalSteam(where: string, fields: string): Promise<RawExternalGame[]> {
  try {
    return await igdb<RawExternalGame[]>(
      'external_games',
      `fields ${fields}; where ${where} & external_game_source = 1; limit 500;`
    );
  } catch {
    return igdb<RawExternalGame[]>(
      'external_games',
      `fields ${fields}; where ${where} & category = 1; limit 500;`
    );
  }
}

/** Jogos da IGDB correspondentes a appIds da Steam (para importar da Steam). */
async function steamLookup(appIds: number[]) {
  const uids = appIds.map((id) => `"${id}"`).join(',');
  const prefixed = SUMMARY_FIELDS.split(', ')
    .map((field) => `game.${field}`)
    .join(', ');
  const rows = await externalSteam(`uid = (${uids})`, `uid, ${prefixed}`);
  const seen = new Set<number>();
  const matches: { appId: number; game: ReturnType<typeof toSummary> }[] = [];
  for (const row of rows) {
    const appId = Number(row.uid);
    if (!row.game || typeof row.game === 'number' || seen.has(appId) || isAdult(row.game)) continue;
    seen.add(appId);
    matches.push({ appId, game: toSummary(row.game) });
  }
  return matches;
}

// ---------- Casamento por nome (PSN e outras plataformas sem id comum) ----------

/** Nome limpo para mandar na query: sem ™/®/©, aspas e barras. */
function queryName(name: string) {
  return name.replace(/[™®©]/g, '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** Melhor candidato: nome igual (3) antes de "igual tirando a edição" (2). */
function bestMatch(candidates: RawGame[], name: string) {
  return (
    candidates
      .filter(notAdult)
      .map((game) => ({ game, score: nameMatchScore(game.name, name) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.game ?? null
  );
}

/** Quantas buscas individuais (2ª etapa) cabem numa chamada, para não estourar o tempo. */
const MAX_SEARCHES_PER_CALL = 20;

/**
 * Acha o jogo da IGDB de cada nome, em duas etapas:
 * 1. Nome exato (sem diferenciar maiúsculas) em lote, pelo /multiquery —
 *    até 10 nomes por requisição. ATENÇÃO: `search` NÃO funciona dentro do
 *    multiquery (devolve vazio, sem erro); por isso o lote usa `where name ~`.
 * 2. Quem sobrou vai pela busca normal, uma por vez (limite de 4 req/s), e
 *    só aceita nome igual ou igual tirando "Deluxe Edition" e afins —
 *    melhor não importar do que importar o jogo errado.
 */
async function matchNames(names: string[]) {
  const found = new Map<string, RawGame | null>();

  for (let i = 0; i < names.length; i += 10) {
    const chunk = names.slice(i, i + 10);
    const body = chunk
      .map(
        (name, index) =>
          `query games "${index}" { fields ${SUMMARY_FIELDS}; ` +
          `where name ~ "${queryName(name)}" & version_parent = null; limit 10; };`
      )
      .join('\n');
    const rows = await cached(`exact:${chunk.join('|').toLowerCase()}`, DETAILS_TTL, () =>
      igdb<{ name: string; result: RawGame[] }[]>('multiquery', body)
    );
    chunk.forEach((name, index) => {
      const result = rows.find((row) => row.name === String(index))?.result ?? [];
      // Mesmo nome em vários jogos (remake, relançamento): o mais avaliado.
      const exact = [...result].sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0));
      found.set(name, bestMatch(exact, name));
    });
  }

  let searches = 0;
  for (const name of names) {
    if (found.get(name) || searches >= MAX_SEARCHES_PER_CALL) continue;
    searches += 1;
    const rows = await cached(`search-match:${name.toLowerCase()}`, DETAILS_TTL, async () => {
      // ~4 por segundo, o limite da IGDB.
      await new Promise((resolve) => setTimeout(resolve, 260));
      return igdb<RawGame[]>(
        'games',
        `search "${queryName(name)}"; fields ${SUMMARY_FIELDS}; where version_parent = null; limit 10;`
      );
    });
    found.set(name, bestMatch(rows, name));
  }

  return names.map((name) => {
    const game = found.get(name);
    return { name, game: game ? toSummary(game) : null };
  });
}

async function details(id: number) {
  return cached(`details:${id}`, DETAILS_TTL, async () => {
    const [rows, ttb, steamRows] = await Promise.all([
      igdb<RawGame[]>('games', `fields ${DETAILS_FIELDS}; where id = ${id}; limit 1;`),
      // Tempo para zerar é opcional: se o endpoint falhar, a tela só não mostra.
      igdb<TimeToBeat[]>(
        'game_time_to_beats',
        `fields hastily, normally, completely; where game_id = ${id}; limit 1;`
      ).catch(() => [] as TimeToBeat[]),
      // Também opcional: sem o appId, a tela só não mostra o card da Steam.
      externalSteam(`game = ${id}`, 'uid').catch(() => [] as RawExternalGame[]),
    ]);
    const game = rows[0];
    // Jogo erótico: some como se não existisse (o app mostra "não encontrado").
    if (!game || isAdult(game)) return null;
    const time = ttb[0];
    const timeToBeat =
      time && (time.hastily || time.normally || time.completely)
        ? {
            hastily: time.hastily ?? null,
            normally: time.normally ?? null,
            completely: time.completely ?? null,
          }
        : null;
    const steamAppId = steamRows.map((row) => Number(row.uid)).find((n) => n > 0) ?? null;
    return toDetails(game, timeToBeat, steamAppId);
  });
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Use POST.' }, { status: 405 });
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Response.json(
      { error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET não configurados.' },
      { status: 500 }
    );
  }

  // A chave anon também passa na verificação de JWT do gateway; exigir um
  // usuário logado impede que alguém use a cota da IGDB só com a chave
  // pública que vai dentro do app.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !user) return Response.json({ error: 'Não autenticado.' }, { status: 401 });

  let body: {
    action?: string;
    query?: unknown;
    list?: unknown;
    id?: unknown;
    appIds?: unknown[];
    names?: unknown[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'search': {
        if (typeof body.query !== 'string') break;
        return Response.json({ games: await search(body.query) });
      }
      case 'list': {
        const name = body.list;
        if (name !== 'trending' && name !== 'upcoming' && name !== 'recent' && name !== 'top') break;
        return Response.json({ games: await list(name) });
      }
      case 'matchNames': {
        const names = Array.isArray(body.names)
          ? body.names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          : [];
        if (names.length === 0 || names.length > 40) break;
        return Response.json({ matches: await matchNames(names) });
      }
      case 'steamLookup': {
        const appIds = Array.isArray(body.appIds)
          ? body.appIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [];
        if (appIds.length === 0 || appIds.length > 200) break;
        return Response.json({ matches: await steamLookup(appIds) });
      }
      case 'details': {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) break;
        const game = await details(id);
        if (!game) return Response.json({ error: 'Jogo não encontrado.' }, { status: 404 });
        return Response.json({ game });
      }
    }
    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: 'Não foi possível falar com a IGDB agora.' },
      { status: 502 }
    );
  }
});
