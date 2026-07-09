/**
 * Edge Function: exclui a conta autenticada (obrigatório pelas políticas da
 * App Store / Play Store para apps com cadastro).
 *
 * Só apaga o usuário que fez a requisição — o id vem do token JWT validado
 * pelo Supabase, nunca de um parâmetro enviado pelo cliente. Isso evita que
 * alguém apague a conta de outra pessoa.
 *
 * Ao apagar o usuário em auth.users, o cascade do schema.sql já remove
 * perfil, séries seguidas, episódios assistidos, notas, comentários,
 * amizades e push tokens. As mídias do bucket comment-media não têm FK, por
 * isso são removidas manualmente aqui.
 *
 * Deploy:
 *   supabase functions deploy delete-account
 * (mantém a verificação de JWT ligada — sem --no-verify-jwt)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Cabeçalho Authorization ausente.', { status: 401 });
  }

  // Cliente com o token de quem chamou, só pra descobrir quem é.
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

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Remove as mídias enviadas pelo usuário (ficam em comment-media/<user.id>/...).
  const { data: files } = await adminClient.storage.from('comment-media').list(user.id);
  if (files && files.length > 0) {
    await adminClient.storage
      .from('comment-media')
      .remove(files.map((file) => `${user.id}/${file.name}`));
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return new Response(deleteError.message, { status: 500 });
  }

  return Response.json({ deleted: true });
});
