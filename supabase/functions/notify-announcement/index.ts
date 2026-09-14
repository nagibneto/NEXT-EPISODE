/**
 * Edge Function: aviso único para toda a base ("siga a gente no Instagram").
 *
 * Diferente das outras, não tem cron: é disparada à mão, uma vez. Cada usuário
 * que recebe ganha uma linha em campaign_deliveries com a campaign_key da
 * campanha — rodar de novo não notifica ninguém duas vezes, mesmo que o
 * comando seja repetido por engano.
 *
 * Os textos ficam aqui, numa lista fechada de campanhas. É de propósito: a
 * função é pública, e aceitar título/corpo pelo corpo da requisição
 * transformaria a URL num jeito de mandar push arbitrário para toda a base.
 * Para anunciar outra coisa no futuro, adicione uma campanha nova aqui (chave
 * nova!) e o banner correspondente em src/lib/announcements.ts.
 *
 * Deploy:
 *   supabase secrets set CAMPAIGN_PUSH_TOKEN=<segredo aleatório>
 *   supabase functions deploy notify-announcement --no-verify-jwt
 *
 * Disparo (sempre com o CAMPAIGN_PUSH_TOKEN):
 *   # 1. Ensaio: conta quantos receberiam, sem enviar nada.
 *   curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-announcement' \
 *     -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"dry_run": true}'
 *
 *   # 2. Teste no seu próprio aparelho (não marca entrega: a campanha de
 *   #    verdade ainda vai chegar normalmente depois).
 *   curl ... -d '{"test_user_id": "SEU_UUID"}'
 *
 *   # 3. Pra valer.
 *   curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-announcement' \
 *     -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
 *     -H 'Content-Type: application/json' \
 *     -d '{}'
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK = 100;

type Language = 'pt-BR' | 'en-US';

interface Campaign {
  /** Precisa ser igual à chave do banner no app (src/lib/announcements.ts). */
  key: string;
  strings: Record<Language, { title: string; body: string }>;
}

/**
 * Campanhas conhecidas. A chave carrega a data para deixar claro que trocar o
 * conteúdo exige chave nova — reaproveitar a antiga faria a campanha ser
 * pulada por todo mundo que já recebeu a anterior.
 */
const CAMPAIGNS: Campaign[] = [
  {
    key: 'instagram-2026-09',
    strings: {
      'pt-BR': {
        title: 'Estamos no Instagram! 📸',
        body: 'Siga @app.nextepisode e acompanhe as novidades do app em primeira mão.',
      },
      'en-US': {
        title: "We're on Instagram! 📸",
        body: 'Follow @app.nextepisode and be the first to hear what’s coming to the app.',
      },
    },
  },
];

const DEFAULT_CAMPAIGN_KEY = CAMPAIGNS[CAMPAIGNS.length - 1].key;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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

  // Corpo vazio é o caso normal (dispara a campanha mais recente).
  const body = await req.json().catch(() => ({}));
  const campaignKey: string = body.campaign_key ?? DEFAULT_CAMPAIGN_KEY;
  const dryRun: boolean = body.dry_run === true;
  /**
   * Teste: manda só para este usuário, ignorando preferência e entrega já
   * registrada, e sem gravar nada. Serve para ver a notificação no próprio
   * aparelho sem queimar a campanha — quem testa recebe de novo no disparo real.
   */
  const testUserId: string | null = typeof body.test_user_id === 'string' ? body.test_user_id : null;

  const campaign = CAMPAIGNS.find((item) => item.key === campaignKey);
  if (!campaign) {
    return Response.json(
      { error: `Campanha desconhecida: ${campaignKey}`, known: CAMPAIGNS.map((item) => item.key) },
      { status: 400 }
    );
  }

  // 1. Todos os aparelhos registrados (ou só os do usuário de teste).
  const tokenQuery = supabase.from('push_tokens').select('user_id, token');
  const { data: tokenRows, error: tokensError } = await (testUserId
    ? tokenQuery.eq('user_id', testUserId)
    : tokenQuery);
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
  const totalUsers = tokensByUser.size;

  // Num teste os filtros abaixo não valem: a graça é receber a notificação
  // mesmo já tendo visto o banner ou desligado a preferência.
  if (!testUserId) {
    // 2. Tira quem desligou avisos do app no Perfil → Notificações.
    const { data: optedOutRows, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('user_id')
      .eq('announcements', false);
    if (prefsError) throw prefsError;
    for (const row of optedOutRows ?? []) {
      tokensByUser.delete(row.user_id);
    }

    // 3. Tira quem já recebeu esta campanha — ou já viu o banner dentro do app
    //    antes do push sair (aí a novidade já não é novidade).
    const { data: deliveredRows, error: deliveredError } = await supabase
      .from('campaign_deliveries')
      .select('user_id')
      .eq('campaign_key', campaign.key);
    if (deliveredError) throw deliveredError;
    for (const row of deliveredRows ?? []) {
      tokensByUser.delete(row.user_id);
    }
  }

  if (tokensByUser.size === 0) {
    return Response.json({
      campaign: campaign.key,
      users: totalUsers,
      sent: 0,
      reason: testUserId
        ? 'usuário de teste sem push token'
        : 'todo mundo já recebeu ou está desinscrito',
    });
  }

  // 4. Idioma de cada um, para notificar no idioma certo.
  const recipients = [...tokensByUser.keys()];
  const { data: languageRows, error: languageError } = await supabase
    .from('profiles')
    .select('id, language');
  if (languageError) throw languageError;
  const languageByUser = new Map<string, Language>();
  for (const row of languageRows ?? []) {
    languageByUser.set(row.id, row.language === 'en-US' ? 'en-US' : 'pt-BR');
  }

  const messages: { to: string; title: string; body: string; data: Record<string, string> }[] = [];
  for (const userId of recipients) {
    const strings = campaign.strings[languageByUser.get(userId) ?? 'pt-BR'];
    for (const token of tokensByUser.get(userId) ?? []) {
      messages.push({
        to: token,
        title: strings.title,
        body: strings.body,
        // Sem `url`: tocar na notificação abre o app normalmente e quem mostra
        // o convite é o banner (AnnouncementPrompt), o mesmo que apareceria de
        // qualquer jeito na próxima abertura.
        data: { type: 'announcement', campaignKey: campaign.key },
      });
    }
  }

  if (dryRun) {
    return Response.json({
      campaign: campaign.key,
      dryRun: true,
      users: totalUsers,
      recipients: recipients.length,
      candidates: messages.length,
    });
  }

  // 5. Envia em lotes para a API de push da Expo.
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

  // 6. Marca quem recebeu, para um disparo repetido não notificar de novo.
  //    Teste não marca nada: a campanha de verdade ainda tem que chegar.
  if (!testUserId && deliveredUsers.size > 0) {
    const pushedAt = new Date().toISOString();
    const { error: deliveryError } = await supabase.from('campaign_deliveries').upsert(
      [...deliveredUsers].map((userId) => ({
        user_id: userId,
        campaign_key: campaign.key,
        pushed_at: pushedAt,
      })),
      { onConflict: 'user_id,campaign_key' }
    );
    if (deliveryError) throw deliveryError;
  }

  // 7. Remove tokens de aparelhos que desinstalaram o app.
  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return Response.json({
    campaign: campaign.key,
    test: testUserId ? true : undefined,
    users: totalUsers,
    candidates: messages.length,
    sent,
    notified: deliveredUsers.size,
    removedTokens: staleTokens.length,
  });
});
