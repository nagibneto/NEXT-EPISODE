/**
 * Edge Function: conquistas PÚBLICAS do Xbox para o modo Games.
 *
 * ATENÇÃO — API NÃO OFICIAL. Usa os serviços do próprio Xbox Live (os mesmos
 * do app do Xbox e do xbox.com, como as bibliotecas xbox-webapi/xboxreplay).
 * Pode quebrar sem aviso.
 *
 * Como funciona: uma conta Microsoft "robô" entrou UMA vez pelo login
 * oficial da Microsoft, no app "Next Episode Xbox" registrado no Azure
 * (scripts/xbox-login.mjs), e isso gerou um refresh token. Aqui ele vira
 * tokens do Xbox Live:
 *   refresh token (Microsoft) → access token → user token (Xbox) → XSTS
 * O refresh token da Microsoft é trocado a cada uso; o atual fica na tabela
 * service_tokens (só a service role lê). O secret XBOX_REFRESH_TOKEN é só a
 * semente inicial.
 *
 * O usuário do app só informa a gamertag; a gente lê as conquistas se a
 * privacidade dele permitir.
 *
 * Corpo (POST, JSON):
 *   { action: 'resolve', input: string }                    → { profile }
 *   { action: 'stats', xuid, gameName, lang? }              → { stats }
 *   { action: 'recent', xuid }                              → { titles }
 *   { action: 'history', xuid }                             → { titles } (todos)
 *
 * Secrets: XBOX_CLIENT_ID, XBOX_REFRESH_TOKEN
 * Deploy:  supabase functions deploy xbox
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { nameMatchScore } from '../_shared/names.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('XBOX_CLIENT_ID') ?? '';
const SEED_REFRESH_TOKEN = Deno.env.get('XBOX_REFRESH_TOKEN') ?? '';

const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const SCOPE = 'XboxLive.signin offline_access';

const XUID_REGEX = /^\d{10,20}$/;
// Gamertag: até 15 caracteres (letras, números, espaço) + sufixo #1234 opcional.
const GAMERTAG_REGEX = /^[A-Za-z0-9 ]{1,15}(#\d{1,4})?$/;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

class XboxAuthError extends Error {}

// ---------- Tokens ----------

interface XblAuth {
  uhs: string;
  token: string;
  expiresAt: number;
}

let memoryAuth: XblAuth | null = null;

async function refreshMicrosoft(refreshToken: string) {
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new XboxAuthError(`refresh Microsoft ${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

/** access token da Microsoft → XSTS do Xbox Live (vale ~16 h). */
async function xboxTokens(msAccessToken: string): Promise<XblAuth> {
  const userRes = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        // "d=" = token de app registrado no Azure (MSAL).
        RpsTicket: `d=${msAccessToken}`,
      },
    }),
  });
  if (!userRes.ok) throw new XboxAuthError(`user token ${userRes.status}`);
  const userToken = (await userRes.json()).Token as string;

  const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://xboxlive.com',
      TokenType: 'JWT',
      Properties: { UserTokens: [userToken], SandboxId: 'RETAIL' },
    }),
  });
  if (!xstsRes.ok) throw new XboxAuthError(`XSTS ${xstsRes.status}`);
  const xsts = await xstsRes.json();
  return {
    uhs: xsts.DisplayClaims.xui[0].uhs,
    token: xsts.Token,
    expiresAt: Date.parse(xsts.NotAfter),
  };
}

async function getAuth(): Promise<XblAuth> {
  if (memoryAuth && memoryAuth.expiresAt - 5 * 60_000 > Date.now()) return memoryAuth;
  if (!CLIENT_ID) throw new XboxAuthError('XBOX_CLIENT_ID não configurado.');

  const { data: row } = await admin
    .from('service_tokens')
    .select('access_token, access_expires_at, refresh_token')
    .eq('service', 'xbox')
    .maybeSingle();

  // XSTS ainda válido no banco (guardado como "uhs;token").
  if (row?.access_token && row.access_expires_at) {
    const expiresAt = Date.parse(row.access_expires_at);
    if (expiresAt - 5 * 60_000 > Date.now()) {
      const [uhs, ...rest] = (row.access_token as string).split(';');
      memoryAuth = { uhs, token: rest.join(';'), expiresAt };
      return memoryAuth;
    }
  }

  // Refresh do banco primeiro; se a Microsoft recusar, tenta a semente (o
  // secret) — é o caso de quem rodou o scripts/xbox-login.mjs de novo.
  const candidates = [row?.refresh_token, SEED_REFRESH_TOKEN].filter(
    (token, index, list): token is string => Boolean(token) && list.indexOf(token) === index
  );
  if (candidates.length === 0) throw new XboxAuthError('XBOX_REFRESH_TOKEN não configurado.');

  let lastError: unknown = null;
  for (const refreshToken of candidates) {
    try {
      const ms = await refreshMicrosoft(refreshToken);
      const auth = await xboxTokens(ms.access_token);
      const now = Date.now();
      await admin.from('service_tokens').upsert({
        service: 'xbox',
        access_token: `${auth.uhs};${auth.token}`,
        access_expires_at: new Date(auth.expiresAt).toISOString(),
        // A Microsoft troca o refresh token a cada uso; guardar o novo é
        // o que mantém o acesso vivo sem login de novo.
        refresh_token: ms.refresh_token,
        refresh_expires_at: new Date(now + 90 * 86_400_000).toISOString(),
        updated_at: new Date(now).toISOString(),
      });
      memoryAuth = auth;
      return auth;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof XboxAuthError ? lastError : new XboxAuthError(String(lastError));
}

/** GET no Xbox Live. Devolve status + JSON; 401 renova os tokens uma vez. */
async function xbl(url: string, contract: string, lang = 'en-US', retried = false) {
  const auth = await getAuth();
  const res = await fetch(url, {
    headers: {
      Authorization: `XBL3.0 x=${auth.uhs};${auth.token}`,
      'x-xbl-contract-version': contract,
      'Accept-Language': lang,
      Accept: 'application/json',
    },
  });
  if (res.status === 401 && !retried) {
    memoryAuth = null;
    await admin.from('service_tokens').update({ access_expires_at: null }).eq('service', 'xbox');
    return xbl(url, contract, lang, true);
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

// ---------- Títulos (histórico de jogos com conquistas) ----------

interface XboxTitle {
  titleId: string;
  name: string;
  type: string;
  devices?: string[];
  displayImage?: string;
  achievement?: {
    currentAchievements: number;
    totalAchievements: number;
    currentGamerscore: number;
    totalGamerscore: number;
    progressPercentage: number;
  };
  titleHistory?: { lastTimePlayed?: string };
}

/** null = histórico de jogos privado. */
async function getTitles(xuid: string, lang = 'en-US'): Promise<XboxTitle[] | null> {
  return cached(`titles:${xuid}:${lang}`, 10 * 60 * 1000, async () => {
    const { status, body } = await xbl(
      `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/achievement,image`,
      '2',
      lang
    );
    if (status !== 200 || !body) return null;
    return ((body.titles ?? []) as XboxTitle[]).filter((title) => title.type === 'Game');
  });
}

// ---------- Ações ----------

async function resolve(raw: string) {
  const gamertag = raw.trim();
  if (!GAMERTAG_REGEX.test(gamertag)) return null;
  const { status, body } = await xbl(
    `https://profile.xboxlive.com/users/gt(${encodeURIComponent(gamertag)})/profile/settings?settings=Gamertag,GameDisplayPicRaw,Gamerscore`,
    '3'
  );
  const user = body?.profileUsers?.[0];
  if (status !== 200 || !user?.id) return null;
  const setting = (id: string) =>
    (user.settings as { id: string; value: string }[]).find((s) => s.id === id)?.value ?? null;
  const titles = await getTitles(user.id);
  return {
    xuid: String(user.id),
    gamertag: setting('Gamertag') ?? gamertag,
    avatarUrl: setting('GameDisplayPicRaw'),
    gamerscore: Number(setting('Gamerscore') ?? 0),
    isPublic: titles !== null,
  };
}

async function stats(xuid: string, gameName: string, lang: string) {
  const titles = await getTitles(xuid);
  if (titles === null) return { private: true };
  const title =
    titles
      .map((t) => ({ t, score: nameMatchScore(t.name, gameName) }))
      .filter((c) => c.score > 0)
      // Melhor nome; empate (versões diferentes) → mais conquistas feitas.
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.t.achievement?.currentGamerscore ?? 0) - (a.t.achievement?.currentGamerscore ?? 0)
      )[0]?.t ?? null;
  if (!title) return { private: false, owned: false };

  // Últimas conquistas (só jogos de Xbox One/Series/PC; os de 360 usam outro
  // formato e ficam só com a contagem).
  const { status, body } = await cached(`ach:${xuid}:${title.titleId}:${lang}`, 5 * 60 * 1000, () =>
    xbl(
      `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${title.titleId}&unlockedOnly=true&orderBy=UnlockTime&maxItems=8`,
      '2',
      lang
    )
  );
  type Achievement = {
    name: string;
    description?: string;
    lockedDescription?: string;
    progressState: string;
    progression?: { timeUnlocked?: string };
    mediaAssets?: { type: string; url: string }[];
    rewards?: { type: string; value: string }[];
  };
  const latest =
    status === 200
      ? ((body?.achievements ?? []) as Achievement[])
          .filter((a) => a.progressState === 'Achieved')
          .map((a) => ({
            name: a.name,
            description: a.description ?? a.lockedDescription ?? null,
            icon: a.mediaAssets?.find((m) => m.type === 'Icon')?.url ?? null,
            gamerscore: Number(a.rewards?.find((r) => r.type === 'Gamerscore')?.value ?? 0),
            unlockedAt: a.progression?.timeUnlocked ?? null,
          }))
      : [];

  return {
    private: false,
    owned: true,
    devices: title.devices ?? [],
    achievements: title.achievement
      ? {
          unlocked: title.achievement.currentAchievements,
          total: title.achievement.totalAchievements,
          gamerscore: title.achievement.currentGamerscore,
          totalGamerscore: title.achievement.totalGamerscore,
          progress: title.achievement.progressPercentage,
        }
      : null,
    lastPlayed: title.titleHistory?.lastTimePlayed ?? null,
    latest,
  };
}

async function recent(xuid: string) {
  const titles = await getTitles(xuid);
  if (!titles) return [];
  return titles
    .filter((title) => title.titleHistory?.lastTimePlayed)
    .sort(
      (a, b) =>
        Date.parse(b.titleHistory!.lastTimePlayed!) - Date.parse(a.titleHistory!.lastTimePlayed!)
    )
    .slice(0, 40)
    .map((title) => ({ name: title.name, lastPlayed: title.titleHistory!.lastTimePlayed! }));
}

/** Todo o histórico de jogos, com progresso de conquistas, para importar. */
async function history(xuid: string) {
  cache.delete(`titles:${xuid}:en-US`);
  const titles = await getTitles(xuid);
  if (titles === null) return null;
  return titles.map((title) => ({
    name: title.name,
    lastPlayed: title.titleHistory?.lastTimePlayed ?? null,
    // 100% das conquistas = zerado (jogos sem conquista ficam de fora).
    completed:
      (title.achievement?.totalAchievements ?? 0) > 0 &&
      title.achievement!.currentAchievements >= title.achievement!.totalAchievements,
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
    .eq('platform', 'xbox')
    .maybeSingle();
  if (switchRow && !switchRow.enabled) {
    return Response.json(
      { error: 'A integração com o Xbox está desligada no momento.' },
      { status: 503 }
    );
  }

  let body: { action?: string; input?: unknown; xuid?: unknown; gameName?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'resolve': {
        if (typeof body.input !== 'string' || body.input.length > 40) break;
        const profile = await resolve(body.input);
        if (!profile) {
          return Response.json({ error: 'Gamertag não encontrada.' }, { status: 404 });
        }
        return Response.json({ profile });
      }
      case 'stats': {
        const xuid = String(body.xuid ?? '');
        const gameName = typeof body.gameName === 'string' ? body.gameName.slice(0, 200) : '';
        if (!XUID_REGEX.test(xuid) || !gameName) break;
        const lang = body.lang === 'pt-BR' ? 'pt-BR' : 'en-US';
        return Response.json({ stats: await stats(xuid, gameName, lang) });
      }
      case 'history': {
        const xuid = String(body.xuid ?? '');
        if (!XUID_REGEX.test(xuid)) break;
        const titles = await history(xuid);
        if (titles === null) {
          return Response.json({ error: 'O histórico de jogos do Xbox está privado.' }, { status: 403 });
        }
        return Response.json({ titles });
      }
      case 'recent': {
        const xuid = String(body.xuid ?? '');
        if (!XUID_REGEX.test(xuid)) break;
        return Response.json({ titles: await recent(xuid) });
      }
    }
    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    if (err instanceof XboxAuthError) {
      console.error('Autenticação da conta robô do Xbox falhou:', err.message);
      return Response.json(
        { error: 'A conexão com o Xbox precisa ser renovada (scripts/xbox-login.mjs).' },
        { status: 503 }
      );
    }
    console.error(err);
    return Response.json({ error: 'Não foi possível falar com o Xbox agora.' }, { status: 502 });
  }
});
