/**
 * Edge Function: webhook do RevenueCat que mantém profiles.is_premium.
 *
 * O app usa o id do usuário do Supabase como "app user id" no RevenueCat
 * (veja src/lib/purchases.ts), então cada evento diz exatamente qual perfil
 * atualizar. O cliente nunca escreve em is_premium (coluna revogada no
 * schema.sql); só esta função, com service_role, faz isso.
 *
 * Configuração no painel do RevenueCat (Project Settings → Integrations →
 * Webhooks):
 *   - URL: https://SEU-PROJETO.supabase.co/functions/v1/revenuecat-webhook
 *   - Authorization header: o mesmo valor do secret REVENUECAT_WEBHOOK_AUTH
 *
 * Deploy (sem verificação de JWT — o RevenueCat não manda token do Supabase):
 *   supabase secrets set REVENUECAT_WEBHOOK_AUTH="um-valor-secreto-longo"
 *   supabase functions deploy revenuecat-webhook --no-verify-jwt
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_AUTH = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')!;

/** Eventos que deixam (ou confirmam) a assinatura ativa. */
const ACTIVATE = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'PRODUCT_CHANGE',
]);

// CANCELLATION = desligou a renovação automática, mas o período pago segue
// valendo — só EXPIRATION tira o premium de verdade.
const DEACTIVATE = new Set(['EXPIRATION']);

async function setPremium(
  admin: ReturnType<typeof createClient>,
  userId: string,
  isPremium: boolean,
  expiresAtMs: number | null | undefined
) {
  const { error } = await admin
    .from('profiles')
    .update({
      is_premium: isPremium,
      premium_expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    })
    .eq('id', userId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== WEBHOOK_AUTH) {
    return new Response('Não autorizado.', { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  if (!event?.type) {
    return new Response('Evento ausente.', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (event.type === 'TRANSFER') {
      // Assinatura migrou de uma conta para outra (mesmo Apple ID, outro login).
      for (const userId of event.transferred_from ?? []) {
        await setPremium(admin, userId, false, null);
      }
      for (const userId of event.transferred_to ?? []) {
        await setPremium(admin, userId, true, event.expiration_at_ms);
      }
    } else if (ACTIVATE.has(event.type)) {
      await setPremium(admin, event.app_user_id, true, event.expiration_at_ms);
    } else if (DEACTIVATE.has(event.type)) {
      await setPremium(admin, event.app_user_id, false, event.expiration_at_ms);
    }
    // Demais eventos (CANCELLATION, BILLING_ISSUE, TEST...) não mudam o status.
  } catch (err) {
    console.error('Erro ao processar evento do RevenueCat:', err);
    // 500 faz o RevenueCat reenviar o evento depois.
    return new Response('Erro ao atualizar o perfil.', { status: 500 });
  }

  return Response.json({ received: true });
});
