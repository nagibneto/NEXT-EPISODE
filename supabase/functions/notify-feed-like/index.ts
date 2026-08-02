/**
 * Edge Function: notifica por push quando alguém curte uma atividade
 * "assistiu" (série ou filme) de outra pessoa no feed.
 *
 * Disparada na hora por um trigger em feed_likes (veja supabase/schema.sql,
 * seção "Notificação push: curtida no feed").
 *
 * O corpo é sempre a linha de feed_likes envolvida:
 *   { liker_id, owner_id, media_type, tmdb_id }
 *
 * Deploy:
 *   supabase functions deploy notify-feed-like --no-verify-jwt
 * Segredos necessários (supabase secrets set CHAVE=valor):
 *   TMDB_API_KEY — chave v3 ou token v4 da TMDB (mesma de notify-new-episodes).
 * (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

/** Título do que foi curtido: filme vem do próprio banco, série vem da TMDB. */
async function resolveTitle(mediaType: string, tmdbId: number, ownerId: string): Promise<string> {
  if (mediaType === 'movie') {
    const { data } = await supabase
      .from('watched_movies')
      .select('title')
      .eq('user_id', ownerId)
      .eq('tmdb_id', tmdbId)
      .maybeSingle();
    if (data?.title) return data.title;
    return 'um filme';
  }

  const apiKey = Deno.env.get('TMDB_API_KEY');
  if (!apiKey) return 'uma série';
  try {
    const isV4 = apiKey.startsWith('eyJ');
    const url = new URL(`${TMDB_BASE}/tv/${tmdbId}`);
    url.searchParams.set('language', 'pt-BR');
    if (!isV4) url.searchParams.set('api_key', apiKey);
    const response = await fetch(url, {
      headers: isV4 ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) return 'uma série';
    const show = await response.json();
    return show?.name || 'uma série';
  } catch {
    return 'uma série';
  }
}

Deno.serve(async (req) => {
  const {
    liker_id: likerId,
    owner_id: ownerId,
    media_type: mediaType,
    tmdb_id: tmdbId,
  } = await req.json();
  if (!likerId || !ownerId || !mediaType || !tmdbId) {
    return Response.json(
      { error: 'liker_id, owner_id, media_type e tmdb_id são obrigatórios.' },
      { status: 400 }
    );
  }

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('feed_likes')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (prefs?.feed_likes === false) {
    return Response.json({ sent: 0, reason: 'destinatário desativou notificação de curtida' });
  }

  const [{ data: liker }, { data: tokenRows }, title] = await Promise.all([
    supabase.from('profiles').select('username, display_name').eq('id', likerId).maybeSingle(),
    supabase.from('push_tokens').select('token').eq('user_id', ownerId),
    resolveTitle(mediaType, tmdbId, ownerId),
  ]);

  if (!tokenRows || tokenRows.length === 0) {
    return Response.json({ sent: 0, reason: 'destinatário sem push token' });
  }

  const name = liker?.display_name || liker?.username || 'Alguém';
  const messages = tokenRows.map((row: { token: string }) => ({
    to: row.token,
    title: 'Nova curtida',
    body: `${name} curtiu o que você assistiu: ${title}.`,
    data: { type: 'feed_like', likerId, mediaType, tmdbId },
  }));

  let sent = 0;
  const staleTokens: string[] = [];
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (response.ok) {
    const { data: tickets } = await response.json();
    tickets?.forEach((ticket: { status: string; details?: { error?: string } }, index: number) => {
      if (ticket.status === 'ok') {
        sent += 1;
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        staleTokens.push(messages[index].to);
      }
    });
  }

  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return Response.json({ sent, removedTokens: staleTokens.length });
});
