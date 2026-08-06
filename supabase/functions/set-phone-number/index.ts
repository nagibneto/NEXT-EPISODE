/**
 * Edge Function: grava o telefone do usuário autenticado para a busca de
 * amigos pelos contatos (ver supabase/functions/match-contacts).
 *
 * O telefone nunca é gravado direto pelo cliente via supabase-js: a tabela
 * phone_contacts (schema.sql) não tem policy de insert/update de propósito.
 * Só esta function, com a service role, pode escrever — e é ela quem calcula
 * o pepper (PHONE_HASH_PEPPER) somado ao hash, então o cliente nunca precisa
 * conhecer o pepper nem consegue forjar um hash "cru".
 *
 * Além do hash do E.164 completo, grava hash de variantes menos específicas
 * do mesmo número (sem código do país, sem DDD) — espelha
 * phoneMatchVariants() em src/lib/phone.ts — porque quem tem esse telefone
 * salvo na agenda pode ter digitado de um jeito diferente do cadastro.
 *
 * Deploy:
 *   supabase functions deploy set-phone-number
 * (mantém a verificação de JWT ligada — sem --no-verify-jwt)
 *
 * Configuração única (rode no terminal, com a service role key do projeto):
 *   supabase secrets set PHONE_HASH_PEPPER=$(openssl rand -hex 32)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import parsePhoneNumberFromString from 'npm:libphonenumber-js@1.13.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PEPPER = Deno.env.get('PHONE_HASH_PEPPER')!;

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

// Espelha AREA_CODE_LENGTH de src/lib/phone.ts — Deno não importa módulos do
// app diretamente, por isso a duplicação (só estas poucas linhas).
const AREA_CODE_LENGTH: Record<string, number> = { BR: 2, US: 3, CA: 3 };

async function pepperedHash(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** sha256 simples (sem pepper) do número em si, pra depois pepperar — mesmo formato do cliente. */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
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

  const { phone_number: phoneNumber } = await req.json();
  if (typeof phoneNumber !== 'string' || !E164_REGEX.test(phoneNumber)) {
    return Response.json(
      { error: 'phone_number precisa estar no formato E.164 (ex.: +5511999999999).' },
      { status: 400 }
    );
  }

  const parsed = parsePhoneNumberFromString(phoneNumber);
  const nationalNumber = parsed?.nationalNumber ?? phoneNumber;
  const areaCodeLength = parsed?.country ? AREA_CODE_LENGTH[parsed.country] : undefined;
  const localNumber =
    areaCodeLength && nationalNumber.length > areaCodeLength
      ? nationalNumber.slice(areaCodeLength)
      : null;

  const [phoneHash, phoneHashNational, phoneHashLocal] = await Promise.all([
    pepperedHash(await sha256(phoneNumber)),
    pepperedHash(await sha256(nationalNumber)),
    localNumber ? pepperedHash(await sha256(localNumber)) : Promise.resolve(null),
  ]);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient.from('phone_contacts').upsert({
    user_id: user.id,
    phone_number: phoneNumber,
    phone_hash: phoneHash,
    phone_hash_national: phoneHashNational,
    phone_hash_local: phoneHashLocal,
  });

  if (error) {
    // Hash duplicado = esse telefone já está cadastrado em outra conta.
    if (error.code === '23505') {
      return Response.json(
        { error: 'Esse telefone já está cadastrado em outra conta.' },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ saved: true });
});
