/**
 * Edge Function: notifica usuários sobre episódios que estreiam hoje,
 * via Expo Push, mesmo com o app fechado.
 *
 * Executada 1x por dia por um cron (veja supabase/schema.sql, seção "Cron").
 *
 * Deploy:
 *   supabase functions deploy notify-new-episodes --no-verify-jwt
 * Segredos necessários (supabase secrets set CHAVE=valor):
 *   TMDB_API_KEY — chave v3 ou token v4 da TMDB.
 * (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK = 100;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface TmdbEpisode {
  name: string;
  season_number: number;
  episode_number: number;
  air_date: string | null;
}

interface TmdbShow {
  name: string;
  next_episode_to_air: TmdbEpisode | null;
  last_episode_to_air: TmdbEpisode | null;
}

async function fetchShow(tmdbId: number): Promise<TmdbShow | null> {
  const apiKey = Deno.env.get('TMDB_API_KEY');
  if (!apiKey) throw new Error('Segredo TMDB_API_KEY não configurado.');
  const isV4 = apiKey.startsWith('eyJ');
  const url = new URL(`${TMDB_BASE}/tv/${tmdbId}`);
  url.searchParams.set('language', 'pt-BR');
  if (!isV4) url.searchParams.set('api_key', apiKey);
  const response = await fetch(url, {
    headers: isV4 ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) return null;
  return response.json();
}

/** Episódio da série que estreia na data informada (YYYY-MM-DD), se houver. */
function episodeAiringOn(show: TmdbShow, date: string): TmdbEpisode | null {
  if (show.next_episode_to_air?.air_date === date) return show.next_episode_to_air;
  if (show.last_episode_to_air?.air_date === date) return show.last_episode_to_air;
  return null;
}

Deno.serve(async () => {
  // 1. Tokens de push por usuário.
  const { data: tokenRows, error: tokensError } = await supabase
    .from('push_tokens')
    .select('user_id, token');
  if (tokensError) throw tokensError;
  if (!tokenRows || tokenRows.length === 0) {
    return Response.json({ sent: 0, reason: 'nenhum push token cadastrado' });
  }

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokenRows) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row.token);
    tokensByUser.set(row.user_id, list);
  }

  // 2. Séries seguidas pelos usuários que têm token.
  const { data: followRows, error: followsError } = await supabase
    .from('followed_shows')
    .select('user_id, tmdb_id')
    .in('user_id', [...tokensByUser.keys()]);
  if (followsError) throw followsError;

  const followersByShow = new Map<number, string[]>();
  for (const row of followRows ?? []) {
    const list = followersByShow.get(row.tmdb_id) ?? [];
    list.push(row.user_id);
    followersByShow.set(row.tmdb_id, list);
  }

  // 3. Para cada série, verifica se um episódio estreia hoje (UTC).
  const today = new Date().toISOString().slice(0, 10);
  const messages: {
    to: string;
    title: string;
    body: string;
    data: Record<string, number>;
  }[] = [];

  for (const [tmdbId, followers] of followersByShow) {
    try {
      const show = await fetchShow(tmdbId);
      if (!show) continue;
      const episode = episodeAiringOn(show, today);
      if (!episode) continue;

      const code = `S${String(episode.season_number).padStart(2, '0')}E${String(
        episode.episode_number
      ).padStart(2, '0')}`;
      for (const userId of followers) {
        for (const token of tokensByUser.get(userId) ?? []) {
          messages.push({
            to: token,
            title: `Novo episódio de ${show.name}!`,
            body: `${code} — "${episode.name}" estreia hoje.`,
            data: {
              tmdbShowId: tmdbId,
              seasonNumber: episode.season_number,
              episodeNumber: episode.episode_number,
            },
          });
        }
      }
    } catch {
      // Falha em uma série não deve impedir as demais.
    }
  }

  // 4. Envia em lotes para a API de push da Expo.
  let sent = 0;
  const staleTokens: string[] = [];
  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) continue;
    const { data: tickets } = await response.json();
    tickets?.forEach((ticket: { status: string; details?: { error?: string } }, index: number) => {
      if (ticket.status === 'ok') {
        sent += 1;
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        staleTokens.push(chunk[index].to);
      }
    });
  }

  // 5. Remove tokens de aparelhos que desinstalaram o app.
  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return Response.json({ candidates: messages.length, sent, removedTokens: staleTokens.length });
});
