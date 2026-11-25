/**
 * Edge Function: leitura de dados PÚBLICOS da Steam (Steam Web API,
 * https://partner.steamgames.com/doc/webapi) para o modo Games.
 *
 * O usuário só informa o perfil (nome da URL personalizada, link ou
 * SteamID) — sem login. A gente lê o que qualquer pessoa veria no perfil
 * público; perfil privado na Steam = nada aparece, por escolha da pessoa.
 * A chave da API fica só aqui no servidor.
 *
 * Corpo (POST, JSON):
 *   { action: 'resolve', input: string }
 *   { action: 'stats', steamId: string, appId: number, lang?: 'pt-BR' | 'en-US' }
 *   { action: 'recent', steamId: string }
 *   { action: 'history', steamId: string }   (todos os jogos já abertos, para importar)
 *
 * Secret: STEAM_API_KEY (https://steamcommunity.com/dev/apikey)
 *
 * Deploy:
 *   supabase functions deploy steam
 * (mantém a verificação de JWT ligada — sem --no-verify-jwt)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const STEAM_KEY = Deno.env.get('STEAM_API_KEY') ?? '';

const API = 'https://api.steampowered.com';
const STEAM_ID_REGEX = /^\d{17}$/;

// ---------- Cache em memória (vive enquanto a instância estiver quente) ----------

const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  if (cache.size > 1000) cache.clear();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

/** GET na Steam Web API. Devolve status + JSON (a Steam usa 400/403 para "sem stats"/"privado"). */
async function steam(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams({ key: STEAM_KEY, format: 'json' });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const res = await fetch(`${API}/${path}?${query}`);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Algumas respostas de erro vêm em HTML.
  }
  return { status: res.status, body: body as Record<string, any> | null };
}

// ---------- Perfil ----------

interface SteamProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
  /** false = perfil privado/só amigos (communityvisibilitystate != 3). */
  isPublic: boolean;
}

/**
 * Aceita o que a pessoa costuma ter em mãos: o nome da URL personalizada
 * ("fulano"), o link do perfil (…/id/fulano ou …/profiles/7656…) ou o
 * SteamID de 17 dígitos.
 */
function parseInput(raw: string): { steamId: string } | { vanity: string } | null {
  const input = raw.trim().replace(/^@/, '');
  if (!input) return null;
  if (STEAM_ID_REGEX.test(input)) return { steamId: input };
  const profiles = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profiles) return { steamId: profiles[1] };
  const vanityUrl = input.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
  if (vanityUrl) return { vanity: vanityUrl[1] };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(input)) return { vanity: input };
  return null;
}

/** Chave inválida: a Steam responde 401/403 em qualquer endpoint de perfil. */
class SteamKeyRejected extends Error {}

function assertKeyAccepted(status: number) {
  if (status === 401 || status === 403) throw new SteamKeyRejected();
}

async function getProfile(steamId: string): Promise<SteamProfile | null> {
  const { status, body } = await steam('ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId });
  assertKeyAccepted(status);
  const player = body?.response?.players?.[0];
  if (!player) return null;
  return {
    steamId: player.steamid,
    name: player.personaname,
    avatarUrl: player.avatarfull ?? player.avatarmedium ?? null,
    profileUrl: player.profileurl,
    isPublic: player.communityvisibilitystate === 3,
  };
}

async function resolve(raw: string): Promise<SteamProfile | null> {
  const parsed = parseInput(raw);
  if (!parsed) return null;
  let steamId: string;
  if ('steamId' in parsed) {
    steamId = parsed.steamId;
  } else {
    const { status, body } = await steam('ISteamUser/ResolveVanityURL/v1/', {
      vanityurl: parsed.vanity,
    });
    assertKeyAccepted(status);
    if (body?.response?.success !== 1) return null;
    steamId = body.response.steamid;
  }
  return getProfile(steamId);
}

// ---------- Jogos e conquistas ----------

interface OwnedGame {
  appid: number;
  playtime_forever: number;
  rtime_last_played?: number;
}

/** null = detalhes de jogos privados (a Steam responde sem a lista). */
async function getOwnedGames(steamId: string): Promise<Map<number, OwnedGame> | null> {
  return cached(`owned:${steamId}`, 10 * 60 * 1000, async () => {
    const { body } = await steam('IPlayerService/GetOwnedGames/v1/', {
      steamid: steamId,
      include_played_free_games: 1,
    });
    const games = body?.response?.games as OwnedGame[] | undefined;
    if (!games) return null;
    return new Map(games.map((game) => [game.appid, game]));
  });
}

interface SchemaAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: number;
}

async function getSchema(appId: number, lang: string): Promise<Map<string, SchemaAchievement>> {
  return cached(`schema:${appId}:${lang}`, 24 * 60 * 60 * 1000, async () => {
    const { body } = await steam('ISteamUserStats/GetSchemaForGame/v2/', { appid: appId, l: lang });
    const list = (body?.game?.availableGameStats?.achievements ?? []) as SchemaAchievement[];
    return new Map(list.map((achievement) => [achievement.name, achievement]));
  });
}

async function stats(steamId: string, appId: number, appLang: string) {
  const lang = appLang === 'pt-BR' ? 'brazilian' : 'english';
  const owned = await getOwnedGames(steamId);
  if (owned === null) return { private: true };
  const game = owned.get(appId);
  if (!game) return { private: false, owned: false };

  const [{ status, body }, schema] = await Promise.all([
    steam('ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid: appId, l: lang }),
    getSchema(appId, lang).catch(() => new Map<string, SchemaAchievement>()),
  ]);

  // 400 "Requested app has no stats" = jogo sem conquistas; 403 = conquistas
  // privadas. Nos dois casos a tela mostra só as horas.
  let achievements = null;
  const list = body?.playerstats?.achievements as
    | { apiname: string; achieved: number; unlocktime: number; name?: string; description?: string }[]
    | undefined;
  if (status === 200 && list && list.length > 0) {
    const unlocked = list.filter((a) => a.achieved === 1);
    const latest = [...unlocked]
      .sort((a, b) => b.unlocktime - a.unlocktime)
      .slice(0, 8)
      .map((a) => {
        const info = schema.get(a.apiname);
        return {
          name: info?.displayName ?? a.name ?? a.apiname,
          description: info?.description ?? a.description ?? null,
          icon: info?.icon ?? null,
          unlockedAt: a.unlocktime,
        };
      });
    achievements = { unlocked: unlocked.length, total: list.length, latest };
  }

  return {
    private: false,
    owned: true,
    playtimeMinutes: game.playtime_forever,
    lastPlayed: game.rtime_last_played || null,
    achievements,
  };
}

async function recent(steamId: string) {
  // A lista de recentes não traz a data em que cada jogo foi aberto; ela vem
  // da lista de jogos da conta (rtime_last_played). O app usa essa data para
  // importar só o que foi jogado desde a última sincronização.
  const [{ body }, owned] = await Promise.all([
    steam('IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId, count: 30 }),
    getOwnedGames(steamId).catch(() => null),
  ]);
  const games = (body?.response?.games ?? []) as {
    appid: number;
    name: string;
    playtime_2weeks: number;
    playtime_forever: number;
  }[];
  return games.map((game) => ({
    appId: game.appid,
    name: game.name,
    playtime2Weeks: game.playtime_2weeks,
    playtimeForever: game.playtime_forever,
    lastPlayed: owned?.get(game.appid)?.rtime_last_played || null,
  }));
}

/**
 * Histórico completo: todo jogo da conta com tempo de jogo > 0, com a data
 * da última vez. Conquistas 100% ficariam caras (1 chamada por jogo), então
 * a Steam não marca "Zerei" na importação.
 */
async function history(steamId: string) {
  // Sem cache: a importação quer o estado atual da conta.
  cache.delete(`owned:${steamId}`);
  const owned = await getOwnedGames(steamId);
  if (owned === null) return null;
  return [...owned.values()]
    .filter((game) => game.playtime_forever > 0)
    .map((game) => ({
      appId: game.appid,
      playtimeMinutes: game.playtime_forever,
      lastPlayed: game.rtime_last_played || null,
    }));
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });
  if (!STEAM_KEY) {
    return Response.json({ error: 'STEAM_API_KEY não configurada.' }, { status: 500 });
  }

  // Exige usuário logado (a chave anon sozinha passaria no gateway).
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

  let body: { action?: string; input?: unknown; steamId?: unknown; appId?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'resolve': {
        if (typeof body.input !== 'string' || body.input.length > 200) break;
        const profile = await resolve(body.input);
        if (!profile) {
          return Response.json({ error: 'Perfil da Steam não encontrado.' }, { status: 404 });
        }
        return Response.json({ profile });
      }
      case 'stats': {
        const steamId = String(body.steamId ?? '');
        const appId = Number(body.appId);
        if (!STEAM_ID_REGEX.test(steamId) || !Number.isInteger(appId) || appId <= 0) break;
        const lang = body.lang === 'pt-BR' ? 'pt-BR' : 'en-US';
        return Response.json({ stats: await stats(steamId, appId, lang) });
      }
      case 'history': {
        const steamId = String(body.steamId ?? '');
        if (!STEAM_ID_REGEX.test(steamId)) break;
        const games = await history(steamId);
        if (games === null) {
          return Response.json({ error: 'Os detalhes de jogos da Steam estão privados.' }, { status: 403 });
        }
        return Response.json({ games });
      }
      case 'recent': {
        const steamId = String(body.steamId ?? '');
        if (!STEAM_ID_REGEX.test(steamId)) break;
        return Response.json({ games: await recent(steamId) });
      }
    }
    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    if (err instanceof SteamKeyRejected) {
      console.error('A Steam recusou a STEAM_API_KEY (401/403).');
      return Response.json(
        { error: 'A chave da API da Steam foi recusada. Confira o secret STEAM_API_KEY.' },
        { status: 500 }
      );
    }
    console.error(err);
    return Response.json({ error: 'Não foi possível falar com a Steam agora.' }, { status: 502 });
  }
});
