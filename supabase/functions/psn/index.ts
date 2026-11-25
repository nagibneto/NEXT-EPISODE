/**
 * Edge Function: troféus PÚBLICOS da PlayStation Network para o modo Games.
 *
 * ATENÇÃO — API NÃO OFICIAL. A Sony não tem API pública; isto usa os mesmos
 * endpoints do app oficial da PlayStation (como a biblioteca psn-api e sites
 * como PSNProfiles/Exophase). Pode quebrar sem aviso.
 *
 * Como funciona: uma conta "robô" da PSN (criada só para isso — nunca use
 * a sua conta pessoal) se autentica com o NPSSO dela. O usuário do app só
 * informa o ID online; a gente lê os troféus se a privacidade dele permitir
 * ("Qualquer pessoa" em troféus). Sem login do usuário, sem senha.
 *
 * Tokens: o NPSSO (secret PSN_NPSSO) vale ~2 meses e gera um par
 * access/refresh token, guardado na tabela service_tokens (só a service role
 * lê). O access token dura 1h e é renovado pelo refresh token; quando o
 * refresh expira, um novo NPSSO precisa ser gerado (ver GAMES.md).
 *
 * Corpo (POST, JSON):
 *   { action: 'resolve', input: string }                       → { profile }
 *   { action: 'stats', accountId, gameName, lang? }            → { stats }
 *   { action: 'recent', accountId }                            → { titles }
 *   { action: 'history', accountId }                           → { titles } (todos)
 *
 * Deploy:
 *   supabase functions deploy psn
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { nameMatchScore } from '../_shared/names.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NPSSO = Deno.env.get('PSN_NPSSO') ?? '';

const AUTH_BASE = 'https://ca.account.sony.com/api/authz/v3/oauth';
// Client do app oficial da PlayStation (o mesmo que a psn-api usa).
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_BASIC = 'MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

const TROPHY_API = 'https://m.np.playstation.com/api/trophy/v1';
const PROFILE_API = 'https://us-prof.np.community.playstation.net/userProfile/v1/users';

const ACCOUNT_ID_REGEX = /^\d{1,20}$/;
// ID online da PSN: 3–16 caracteres, letras, números, - e _.
const ONLINE_ID_REGEX = /^[A-Za-z][A-Za-z0-9_-]{2,15}$/;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

class PsnAuthError extends Error {}

// ---------- Tokens ----------

interface TokenRow {
  access_token: string | null;
  access_expires_at: string | null;
  refresh_token: string | null;
  refresh_expires_at: string | null;
}

let memoryToken: { value: string; expiresAt: number } | null = null;

async function saveTokens(body: {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}) {
  const now = Date.now();
  const row: Record<string, string> = {
    service: 'psn',
    access_token: body.access_token,
    access_expires_at: new Date(now + body.expires_in * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  if (body.refresh_token) {
    row.refresh_token = body.refresh_token;
    row.refresh_expires_at = new Date(
      now + (body.refresh_token_expires_in ?? 60 * 86_400) * 1000
    ).toISOString();
  }
  await admin.from('service_tokens').upsert(row);
  memoryToken = { value: body.access_token, expiresAt: now + (body.expires_in - 120) * 1000 };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${CLIENT_BASIC}`,
    },
    body: new URLSearchParams({ ...params, token_format: 'jwt' }),
  });
  if (!res.ok) throw new PsnAuthError(`token ${res.status}`);
  return res.json();
}

/** NPSSO → código de autorização → tokens. Só quando não há refresh válido. */
async function loginWithNpsso() {
  if (!NPSSO) throw new PsnAuthError('PSN_NPSSO não configurado.');
  const query = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
  });
  const res = await fetch(`${AUTH_BASE}/authorize?${query}`, {
    headers: { Cookie: `npsso=${NPSSO}` },
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';
  const params = new URL(location, 'https://x').searchParams;
  const code = params.get('code');
  if (!code) {
    // Ex.: "interaction_required | Email verification required" = a conta
    // robô ainda não confirmou o e-mail na Sony.
    const reason = [params.get('error'), params.get('error_description')].filter(Boolean).join(' | ');
    throw new PsnAuthError(`NPSSO recusado: ${reason || `status ${res.status}`}`);
  }
  await saveTokens(
    await tokenRequest({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
  );
}

async function getAccessToken(): Promise<string> {
  if (memoryToken && memoryToken.expiresAt > Date.now()) return memoryToken.value;

  const { data } = await admin
    .from('service_tokens')
    .select('access_token, access_expires_at, refresh_token, refresh_expires_at')
    .eq('service', 'psn')
    .maybeSingle();
  const row = data as TokenRow | null;
  const now = Date.now();

  if (row?.access_token && row.access_expires_at && Date.parse(row.access_expires_at) - 120_000 > now) {
    memoryToken = { value: row.access_token, expiresAt: Date.parse(row.access_expires_at) - 120_000 };
    return row.access_token;
  }
  if (row?.refresh_token && row.refresh_expires_at && Date.parse(row.refresh_expires_at) > now) {
    try {
      await saveTokens(
        await tokenRequest({
          refresh_token: row.refresh_token,
          grant_type: 'refresh_token',
          scope: SCOPE,
        })
      );
      return memoryToken!.value;
    } catch {
      // Refresh recusado: tenta o NPSSO abaixo.
    }
  }
  await loginWithNpsso();
  return memoryToken!.value;
}

/** GET autenticado. Devolve status + JSON; 401 renova o token uma vez. */
async function psn(url: string, lang = 'en-US', retried = false) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': lang },
  });
  if (res.status === 401 && !retried) {
    memoryToken = null;
    await admin.from('service_tokens').update({ access_expires_at: null }).eq('service', 'psn');
    return psn(url, lang, true);
  }
  let body: Record<string, any> | null = null;
  try {
    body = await res.json();
  } catch {
    // sem corpo
  }
  return { status: res.status, body };
}

// ---------- Cache em memória ----------

const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  if (cache.size > 1000) cache.clear();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

// ---------- Perfil ----------

async function trophiesArePublic(accountId: string) {
  const { status, body } = await psn(`${TROPHY_API}/users/${accountId}/trophySummary`);
  if (status !== 200 || !body) return { isPublic: false, level: null, platinum: null };
  return {
    isPublic: true,
    level: (body.trophyLevel as number) ?? null,
    platinum: (body.earnedTrophies?.platinum as number) ?? null,
  };
}

async function resolve(raw: string) {
  // Aceita "Fulano_123" ou o link do perfil (…/pt-br/profile/Fulano_123).
  const fromUrl = raw.match(/playstation\.com\/[^/]*\/?profile\/([A-Za-z0-9_-]+)/i);
  const onlineId = (fromUrl ? fromUrl[1] : raw).trim();
  if (!ONLINE_ID_REGEX.test(onlineId)) return null;

  const { status, body } = await psn(
    `${PROFILE_API}/${encodeURIComponent(onlineId)}/profile2?fields=onlineId,accountId,avatarUrls`
  );
  const profile = body?.profile;
  if (status !== 200 || !profile?.accountId) return null;

  const avatars = (profile.avatarUrls ?? []) as { size: string; avatarUrl: string }[];
  const avatar =
    avatars.find((a) => a.size === 'xl') ?? avatars.find((a) => a.size === 'l') ?? avatars[0];
  const trophies = await trophiesArePublic(profile.accountId);
  return {
    accountId: String(profile.accountId),
    onlineId: profile.onlineId as string,
    avatarUrl: avatar?.avatarUrl ?? null,
    ...trophies,
  };
}

// ---------- Troféus ----------

interface TrophyTitle {
  npServiceName: 'trophy' | 'trophy2';
  npCommunicationId: string;
  trophyTitleName: string;
  trophyTitlePlatform: string;
  trophyTitleIconUrl: string;
  progress: number;
  earnedTrophies: { bronze: number; silver: number; gold: number; platinum: number };
  definedTrophies: { bronze: number; silver: number; gold: number; platinum: number };
  lastUpdatedDateTime: string;
}

/** null = troféus privados. */
async function getTitles(accountId: string): Promise<TrophyTitle[] | null> {
  return cached(`titles:${accountId}`, 10 * 60 * 1000, async () => {
    const all: TrophyTitle[] = [];
    // 800 por página (máximo da API); quem tem mais que isso pagina.
    for (let offset = 0; offset < 4000; offset += 800) {
      const { status, body } = await psn(
        `${TROPHY_API}/users/${accountId}/trophyTitles?limit=800&offset=${offset}`
      );
      if (status !== 200 || !body) return offset === 0 ? null : all;
      const page = (body.trophyTitles ?? []) as TrophyTitle[];
      all.push(...page);
      if (page.length < 800 || all.length >= (body.totalItemCount ?? 0)) break;
    }
    return all;
  });
}

function findTitle(titles: TrophyTitle[], gameName: string): TrophyTitle | null {
  const candidates = titles
    .map((title) => ({ title, score: nameMatchScore(title.trophyTitleName, gameName) }))
    .filter((c) => c.score > 0)
    // Melhor nome primeiro; empate (versão PS4 e PS5) → mais progresso.
    .sort((a, b) => b.score - a.score || b.title.progress - a.title.progress);
  return candidates[0]?.title ?? null;
}

async function stats(accountId: string, gameName: string, lang: string) {
  const titles = await getTitles(accountId);
  if (titles === null) return { private: true };
  const title = findTitle(titles, gameName);
  if (!title) return { private: false, owned: false };

  const svc = `npServiceName=${title.npServiceName}`;
  const comm = title.npCommunicationId;
  const [earned, defined] = await Promise.all([
    psn(`${TROPHY_API}/users/${accountId}/npCommunicationIds/${comm}/trophyGroups/all/trophies?${svc}`),
    cached(`defs:${comm}:${lang}`, 24 * 60 * 60 * 1000, () =>
      psn(`${TROPHY_API}/npCommunicationIds/${comm}/trophyGroups/all/trophies?${svc}`, lang)
    ),
  ]);

  type Earned = { trophyId: number; earned: boolean; earnedDateTime?: string; trophyType: string };
  type Defined = { trophyId: number; trophyName: string; trophyDetail?: string; trophyIconUrl?: string };
  const definedById = new Map(
    ((defined.body?.trophies ?? []) as Defined[]).map((t) => [t.trophyId, t])
  );
  const latest = ((earned.body?.trophies ?? []) as Earned[])
    .filter((t) => t.earned && t.earnedDateTime)
    .sort((a, b) => Date.parse(b.earnedDateTime!) - Date.parse(a.earnedDateTime!))
    .slice(0, 8)
    .map((t) => {
      const info = definedById.get(t.trophyId);
      return {
        name: info?.trophyName ?? `#${t.trophyId}`,
        description: info?.trophyDetail ?? null,
        icon: info?.trophyIconUrl ?? null,
        type: t.trophyType,
        earnedAt: t.earnedDateTime!,
      };
    });

  return {
    private: false,
    owned: true,
    platform: title.trophyTitlePlatform,
    progress: title.progress,
    earned: title.earnedTrophies,
    defined: title.definedTrophies,
    lastUpdated: title.lastUpdatedDateTime,
    latest,
  };
}

async function recent(accountId: string) {
  const titles = await getTitles(accountId);
  if (!titles) return [];
  return titles.slice(0, 40).map((title) => ({
    name: title.trophyTitleName,
    platform: title.trophyTitlePlatform,
    lastUpdated: title.lastUpdatedDateTime,
  }));
}

/** Todos os jogos com troféu, com progresso, para importar o histórico. */
async function history(accountId: string) {
  cache.delete(`titles:${accountId}`);
  const titles = await getTitles(accountId);
  if (titles === null) return null;
  return titles.map((title) => ({
    name: title.trophyTitleName,
    platform: title.trophyTitlePlatform,
    lastUpdated: title.lastUpdatedDateTime,
    progress: title.progress,
    platinum: title.earnedTrophies.platinum > 0,
  }));
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });

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

  // Interruptor remoto (tabela game_platforms): desligado no banco = a
  // function para de consultar na hora, inclusive para versões antigas do app.
  const { data: switchRow } = await admin
    .from('game_platforms')
    .select('enabled')
    .eq('platform', 'psn')
    .maybeSingle();
  if (switchRow && !switchRow.enabled) {
    return Response.json(
      { error: 'A integração com a PlayStation está desligada no momento.' },
      { status: 503 }
    );
  }

  let body: { action?: string; input?: unknown; accountId?: unknown; gameName?: unknown; lang?: unknown };
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
          return Response.json({ error: 'ID da PSN não encontrado.' }, { status: 404 });
        }
        return Response.json({ profile });
      }
      case 'stats': {
        const accountId = String(body.accountId ?? '');
        const gameName = typeof body.gameName === 'string' ? body.gameName.slice(0, 200) : '';
        if (!ACCOUNT_ID_REGEX.test(accountId) || !gameName) break;
        const lang = body.lang === 'pt-BR' ? 'pt-BR' : 'en-US';
        return Response.json({ stats: await stats(accountId, gameName, lang) });
      }
      case 'history': {
        const accountId = String(body.accountId ?? '');
        if (!ACCOUNT_ID_REGEX.test(accountId)) break;
        const titles = await history(accountId);
        if (titles === null) {
          return Response.json({ error: 'Os troféus da PSN estão privados.' }, { status: 403 });
        }
        return Response.json({ titles });
      }
      case 'recent': {
        const accountId = String(body.accountId ?? '');
        if (!ACCOUNT_ID_REGEX.test(accountId)) break;
        return Response.json({ titles: await recent(accountId) });
      }
    }
    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    if (err instanceof PsnAuthError) {
      console.error('Autenticação da conta robô da PSN falhou:', err.message);
      return Response.json(
        { error: 'A conexão com a PlayStation precisa ser renovada (PSN_NPSSO).' },
        { status: 503 }
      );
    }
    console.error(err);
    return Response.json(
      { error: 'Não foi possível falar com a PlayStation agora.' },
      { status: 502 }
    );
  }
});
