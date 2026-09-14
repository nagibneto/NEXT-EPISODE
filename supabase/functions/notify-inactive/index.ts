/**
 * Edge Function: cutuca por push quem não registra nada no app há 7 dias
 * ("sua série sente sua falta").
 *
 * "Não registrar nada" é decidido pela função SQL public.inactive_users
 * (veja supabase/schema.sql): nenhum episódio/filme/série/favorito/nota/
 * comentário/curtida/quiz/pedido de amizade na janela. Quem criou a conta
 * dentro dos 7 dias fica de fora.
 *
 * Executada 1x por semana por um cron (veja supabase/schema.sql, seção
 * "Cron das notificações remotas"). Quem continua sumido só é cutucado de
 * novo depois de COOLDOWN_DAYS — sem isso, o cron semanal viraria um
 * lembrete toda semana para a mesma pessoa.
 *
 * Deploy:
 *   supabase secrets set CAMPAIGN_PUSH_TOKEN=<segredo aleatório>
 *   supabase functions deploy notify-inactive --no-verify-jwt
 * (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
 *
 * Testes (sempre com o CAMPAIGN_PUSH_TOKEN no Authorization):
 *   {"dry_run": true}              — só conta quem receberia, não envia nada.
 *   {"test_user_id": "SEU_UUID"}   — envia só para você, mesmo estando ativo,
 *                                    e não grava o cooldown de 14 dias.
 *
 * A função é pública (--no-verify-jwt, como as outras), então ela mesma exige
 * o CAMPAIGN_PUSH_TOKEN no Authorization — senão qualquer um que descobrisse a
 * URL poderia furar o cooldown e disparar o lembrete quantas vezes quisesse.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK = 100;

/** Janela de inatividade que dispara o lembrete. */
const INACTIVE_DAYS = 7;
/** Dias mínimos entre dois lembretes para a mesma pessoa. */
const COOLDOWN_DAYS = 14;
/** Chave em campaign_deliveries; a linha é reaproveitada a cada envio. */
const CAMPAIGN_KEY = 'reengagement';

type Language = 'pt-BR' | 'en-US';

/** Textos por idioma — runtime separado do bundle do app, sem acesso ao i18next do cliente. */
const STRINGS: Record<
  Language,
  { titleWithShow: (showName: string) => string; titleGeneric: string; body: string }
> = {
  'pt-BR': {
    titleWithShow: (showName) => `${showName} sente sua falta 📺`,
    titleGeneric: 'Suas séries sentem sua falta 📺',
    body: 'Não esqueça de marcar os filmes e séries que você está assistindo.',
  },
  'en-US': {
    titleWithShow: (showName) => `${showName} misses you 📺`,
    titleGeneric: 'Your shows miss you 📺',
    body: "Don't forget to track the movies and shows you're watching.",
  },
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

/**
 * Roda uma consulta com filtro `in` em lotes. Uma lista de milhares de uuids
 * vira uma URL de dezenas de KB no PostgREST e o gateway recusa (414), então
 * quebramos em pedaços e juntamos as linhas.
 */
const IN_CHUNK = 100;

async function inChunks<T>(
  values: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await run(values.slice(i, i + IN_CHUNK));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

Deno.serve(async (req) => {
  // Segredo dedicado, criado com "supabase secrets set CAMPAIGN_PUSH_TOKEN=...".
  // Não dá para comparar com SUPABASE_SERVICE_ROLE_KEY: o valor injetado no
  // runtime é uma chave do formato novo (sb_secret_...), diferente do JWT
  // service_role que o painel e o CLI entregam — a comparação nunca bateria.
  const expectedToken = Deno.env.get('CAMPAIGN_PUSH_TOKEN');
  if (!expectedToken) {
    return Response.json(
      { error: 'Segredo CAMPAIGN_PUSH_TOKEN não configurado no projeto.' },
      { status: 500 }
    );
  }
  if (req.headers.get('Authorization') !== `Bearer ${expectedToken}`) {
    return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = body.dry_run === true;
  /**
   * Teste: manda só para este usuário, ignorando inatividade, preferência e
   * cooldown, e sem gravar nada. Sem isso só daria para ver a notificação
   * ficando 7 dias sem tocar no app.
   */
  const testUserId: string | null = typeof body.test_user_id === 'string' ? body.test_user_id : null;

  // 1. Quem está sumido há INACTIVE_DAYS dias (ou só o usuário de teste).
  const languageByUser = new Map<string, Language>();
  if (testUserId) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, language')
      .eq('id', testUserId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return Response.json({ error: 'Usuário de teste não encontrado.' }, { status: 400 });
    }
    languageByUser.set(profile.id, profile.language === 'en-US' ? 'en-US' : 'pt-BR');
  } else {
    const { data: inactiveRows, error: inactiveError } = await supabase.rpc('inactive_users', {
      p_days: INACTIVE_DAYS,
    });
    if (inactiveError) throw inactiveError;
    if (!inactiveRows || inactiveRows.length === 0) {
      return Response.json({ sent: 0, reason: 'ninguém inativo na janela' });
    }
    for (const row of inactiveRows as { user_id: string; language: string | null }[]) {
      languageByUser.set(row.user_id, row.language === 'en-US' ? 'en-US' : 'pt-BR');
    }
  }
  const inactiveIds = [...languageByUser.keys()];

  // 2. Só quem tem aparelho registrado.
  const tokenRows = await inChunks<{ user_id: string; token: string }>(inactiveIds, (chunk) =>
    supabase.from('push_tokens').select('user_id, token').in('user_id', chunk)
  );

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokenRows) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row.token);
    tokensByUser.set(row.user_id, list);
  }
  if (tokensByUser.size === 0) {
    return Response.json({
      inactive: inactiveIds.length,
      sent: 0,
      reason: 'nenhum inativo com push token',
    });
  }

  // Num teste os filtros abaixo não valem: a graça é receber a notificação
  // agora, sem esperar o cooldown nem ficar uma semana sem abrir o app.
  if (!testUserId) {
    // 3. Tira quem desligou o lembrete no Perfil → Notificações. Sem filtrar por
    //    usuário: a lista de quem desativou é curta, e assim evitamos a URL longa.
    const { data: optedOutRows, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('user_id')
      .eq('reengagement', false);
    if (prefsError) throw prefsError;
    for (const row of optedOutRows ?? []) {
      tokensByUser.delete(row.user_id);
    }

    // 4. Tira quem já foi cutucado há menos de COOLDOWN_DAYS dias.
    const cooldownStart = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRows, error: recentError } = await supabase
      .from('campaign_deliveries')
      .select('user_id')
      .eq('campaign_key', CAMPAIGN_KEY)
      .gte('pushed_at', cooldownStart);
    if (recentError) throw recentError;
    for (const row of recentRows ?? []) {
      tokensByUser.delete(row.user_id);
    }
  }

  if (tokensByUser.size === 0) {
    return Response.json({
      inactive: inactiveIds.length,
      sent: 0,
      reason: testUserId ? 'usuário de teste sem push token' : 'todos em cooldown ou desinscritos',
    });
  }

  // 5. Uma série seguida para personalizar o texto ("X sente sua falta").
  //    A mais recente de cada um; quem não segue nada leva o texto genérico.
  const recipients = [...tokensByUser.keys()];
  const showRows = await inChunks<{ user_id: string; name: string; name_en: string | null }>(
    recipients,
    (chunk) =>
      supabase
        .from('followed_shows')
        .select('user_id, name, name_en')
        .in('user_id', chunk)
        .order('followed_at', { ascending: false })
  );

  const showByUser = new Map<string, { name: string; name_en: string | null }>();
  for (const row of showRows) {
    if (!showByUser.has(row.user_id)) showByUser.set(row.user_id, row);
  }

  // 6. Monta as mensagens.
  const messages: { to: string; title: string; body: string; data: Record<string, string> }[] = [];
  for (const userId of recipients) {
    const language = languageByUser.get(userId) ?? 'pt-BR';
    const strings = STRINGS[language];
    const show = showByUser.get(userId);
    const showName = show ? (language === 'en-US' ? (show.name_en ?? show.name) : show.name) : null;
    for (const token of tokensByUser.get(userId) ?? []) {
      messages.push({
        to: token,
        title: showName ? strings.titleWithShow(showName) : strings.titleGeneric,
        body: strings.body,
        data: { type: 'reengagement', url: '/' },
      });
    }
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      inactive: inactiveIds.length,
      recipients: recipients.length,
      candidates: messages.length,
      // Uma amostra do texto, para conferir antes de mandar de verdade.
      sample: messages[0] ? { title: messages[0].title, body: messages[0].body } : null,
    });
  }

  // 7. Envia em lotes para a API de push da Expo.
  const userByToken = new Map<string, string>();
  for (const [userId, tokens] of tokensByUser) {
    for (const token of tokens) userByToken.set(token, userId);
  }

  let sent = 0;
  const staleTokens: string[] = [];
  const deliveredUsers = new Set<string>();

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
      const token = chunk[index].to;
      if (ticket.status === 'ok') {
        sent += 1;
        const userId = userByToken.get(token);
        if (userId) deliveredUsers.add(userId);
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        staleTokens.push(token);
      }
    });
  }

  // 8. Marca o cooldown só de quem realmente recebeu.
  //    Teste não marca: senão você ficaria 14 dias sem poder testar de novo.
  if (!testUserId && deliveredUsers.size > 0) {
    const pushedAt = new Date().toISOString();
    const { error: deliveryError } = await supabase.from('campaign_deliveries').upsert(
      [...deliveredUsers].map((userId) => ({
        user_id: userId,
        campaign_key: CAMPAIGN_KEY,
        pushed_at: pushedAt,
      })),
      { onConflict: 'user_id,campaign_key' }
    );
    if (deliveryError) throw deliveryError;
  }

  // 9. Remove tokens de aparelhos que desinstalaram o app.
  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return Response.json({
    test: testUserId ? true : undefined,
    inactive: inactiveIds.length,
    candidates: messages.length,
    sent,
    users: deliveredUsers.size,
    removedTokens: staleTokens.length,
  });
});
