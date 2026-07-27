/**
 * Edge Function: notifica por push quando alguém manda um pedido de amizade.
 *
 * Disparada na hora por um trigger em user_follows (veja supabase/schema.sql,
 * seção "Notificação push: pedido de amizade") — diferente do resumo diário
 * de episódios novos, que roda por cron.
 *
 * Deploy:
 *   supabase functions deploy notify-friend-request --no-verify-jwt
 * (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const { follower_id: followerId, followed_id: followedId } = await req.json();
  if (!followerId || !followedId) {
    return Response.json(
      { error: 'follower_id e followed_id são obrigatórios.' },
      { status: 400 }
    );
  }

  const [{ data: follower }, { data: tokenRows }] = await Promise.all([
    supabase.from('profiles').select('username, display_name').eq('id', followerId).maybeSingle(),
    supabase.from('push_tokens').select('token').eq('user_id', followedId),
  ]);

  if (!tokenRows || tokenRows.length === 0) {
    return Response.json({ sent: 0, reason: 'destinatário sem push token' });
  }

  const name = follower?.display_name || follower?.username || 'Alguém';
  const messages = tokenRows.map((row: { token: string }) => ({
    to: row.token,
    title: 'Novo pedido de amizade',
    body: `${name} quer ser seu amigo.`,
    data: { type: 'friend_request', followerId },
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
