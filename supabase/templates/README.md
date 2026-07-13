# E-mails de autenticação (Supabase)

Passos manuais no painel do Supabase (uma vez só). Resolvem dois problemas:
o e-mail de confirmação "seco" (sem assunto decente nem logo) e a página de
erro que abre ao clicar no link (a confirmação funciona, mas o redirect cai
no Site URL padrão, `http://localhost:3000`).

## 1. Subir o logo no Storage

1. Dashboard → **Storage** → **New bucket** → nome `branding`, marque **Public bucket**.
2. Faça upload de `assets/images/logo.png` para o bucket.
3. A URL pública fica:
   `https://SEU-PROJETO.supabase.co/storage/v1/object/public/branding/logo.png`
   (SEU-PROJETO = a ref que aparece em `EXPO_PUBLIC_SUPABASE_URL`).

## 2. Template do e-mail de confirmação

1. Dashboard → **Authentication** → **Email Templates** → aba **Confirm signup**.
2. Assunto (Subject): `Confirme seu e-mail • Next Episode`
3. Cole o conteúdo de `confirm-signup.html` no corpo (Message body), trocando
   `SEU-PROJETO` na URL do logo.

## 3. Consertar o redirect do link (página de erro)

O link do e-mail passa pelo servidor do Supabase (que confirma o e-mail) e
depois redireciona para a URL que o app mandou em `emailRedirectTo`
(`use-auth.tsx`). Essa URL precisa estar na allowlist, senão o Supabase
redireciona para o Site URL padrão — daí a página de erro.

Dashboard → **Authentication** → **URL Configuration**:

1. Em **Redirect URLs**, adicione:
   - `nextepisode://**` — build de produção/dev build (scheme do `app.json`).
   - `exp://**` — desenvolvimento no Expo Go (a URL `exp://IP:8081/--/login`
     muda por rede, por isso o curinga).
2. Opcional: troque o **Site URL** (fallback) por uma página sua quando houver
   site; enquanto for `localhost`, links abertos no desktop mostram erro.

Com isso, ao tocar no link **no celular com o app instalado**, o navegador
redireciona para o deep link, o app abre e a sessão é aplicada
automaticamente (`applySessionFromUrl` em `src/hooks/use-auth.tsx`) — o
usuário já entra logado, sem tela de erro.

Limitação conhecida: abrindo o link num **desktop** (sem o app), o redirect
para `nextepisode://` não tem para onde ir — o e-mail já avisa para abrir no
celular. A confirmação em si funciona de qualquer forma.
