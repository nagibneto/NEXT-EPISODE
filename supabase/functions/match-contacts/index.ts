/**
 * Edge Function: recebe hashes SHA-256 dos telefones da agenda do celular do
 * usuário autenticado e devolve os perfis do Next Episode que baterem.
 *
 * Nunca recebe nem devolve telefone em texto puro: o cliente já manda os
 * contatos hasheados (ver src/lib/phone.ts — hashPhoneNumber, chamado sobre
 * cada variante de phoneMatchVariants), e a resposta só tem os campos
 * públicos do perfil. Aplica o mesmo pepper de set-phone-number antes de
 * comparar com phone_contacts — por isso precisa da service role, já que a
 * tabela não tem policy de select para outros usuários.
 *
 * Compara contra as três colunas de hash (completo / sem código do país /
 * sem DDD) porque quem salvou o contato pode ter digitado o número de um
 * jeito diferente do que a pessoa cadastrou.
 *
 * Deploy:
 *   supabase functions deploy match-contacts
 * (mantém a verificação de JWT ligada — sem --no-verify-jwt)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PEPPER = Deno.env.get('PHONE_HASH_PEPPER')!;

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
// Cada contato pode virar até 3 hashes (completo/nacional/local) — o teto
// sobe proporcionalmente, mas continua limitado pra não virar um jeito de
// baixar a tabela inteira aos poucos.
const MAX_HASHES = 6000;

// Mesma lista de src/lib/db.ts (REVIEWER_USERNAMES) — contas de revisão das
// lojas não devem aparecer em buscas de amigos.
const REVIEWER_USERNAMES = ['nagib Googleplay', 'revisor_apple'];

async function pepperedHash(hash: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(hash.toLowerCase()));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Cabeçalho Authorization ausente.', { status: 401 });
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response('Não autenticado.', { status: 401 });
  }

  const { hashes } = await req.json();
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return Response.json({ matches: [] });
  }
  if (hashes.length > MAX_HASHES || hashes.some((h) => typeof h !== 'string' || !SHA256_HEX_REGEX.test(h))) {
    return Response.json(
      { error: `Envie no máximo ${MAX_HASHES} hashes SHA-256 válidos.` },
      { status: 400 }
    );
  }

  const pepperedHashes = await Promise.all(hashes.map(pepperedHash));
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // RPC (POST) em vez de .or(...).in(...) via REST: com milhares de hashes
  // isso montaria uma URL gigante e o fetch quebraria com "Invalid URL"
  // (ver comentário da função match_phone_contact_hashes no schema.sql).
  const { data, error } = await adminClient.rpc('match_phone_contact_hashes', {
    hashes: pepperedHashes,
    excluding_user_id: user.id,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  type Row = { id: string; username: string; display_name: string | null; avatar_id: number | null };
  const matches = ((data as unknown as Row[]) ?? []).filter(
    (profile) => !REVIEWER_USERNAMES.includes(profile.username)
  );

  return Response.json({ matches });
});
