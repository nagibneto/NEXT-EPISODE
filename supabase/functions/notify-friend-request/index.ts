/**
 * Edge Function: notifica por push os dois lados de uma amizade — quando
 * alguém manda o pedido e quando o outro aceita.
 *
 * Disparada na hora por triggers em user_follows (veja supabase/schema.sql,
 * seção "Notificação push: amizade") — diferente do resumo diário de
 * episódios novos, que roda por cron.
 *
 * O corpo é sempre a linha de user_follows envolvida, mais o tipo do evento:
 *   { follower_id, followed_id, type: 'request' | 'accepted' }
 * Os papéis se invertem entre os dois: no pedido quem recebe é o followed_id;
 * no aceite quem recebe é o follower_id (que mandou o pedido lá atrás).
 * "type" é opcional e assume 'request' para não quebrar chamadas antigas.
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
  const { follower_id: followerId, followed_id: followedId, type = 'request' } = await req.json();
  if (!followerId || !followedId) {
    return Response.json(
      { error: 'follower_id e followed_id são obrigatórios.' },
      { status: 400 }
    );
  }

  const isAccept = type === 'accepted';
  // Quem recebe o push e quem aparece no texto trocam de lado conforme o evento.
  const recipientId = isAccept ? followerId : followedId;
  const actorId = isAccept ? followedId : followerId;

  const [{ data: actor }, { data: tokenRows }] = await Promise.all([
    supabase.from('profiles').select('username, display_name').eq('id', actorId).maybeSingle(),
    supabase.from('push_tokens').select('token').eq('user_id', recipientId),
  ]);

  if (!tokenRows || tokenRows.length === 0) {
    return Response.json({ sent: 0, type, reason: 'destinatário sem push token' });
  }

  const name = actor?.display_name || actor?.username || 'Alguém';
  const messages = tokenRows.map((row: { token: string }) => ({
    to: row.token,
    title: isAccept ? 'Pedido de amizade aceito' : 'Novo pedido de amizade',
    body: isAccept ? `${name} aceitou seu pedido de amizade.` : `${name} quer ser seu amigo.`,
    data: { type: isAccept ? 'friend_accepted' : 'friend_request', actorId },
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

  return Response.json({ sent, type, removedTokens: staleTokens.length });
});
