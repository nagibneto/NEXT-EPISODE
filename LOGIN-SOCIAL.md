# Login social (Google / Apple / Facebook)

**Código pronto** (Google + Apple; Facebook comentado). Falta só a
configuração nos provedores — nenhuma credencial OAuth existe ainda, então
nada disso é testável até completar os passos abaixo.

Login social convive com o e-mail+senha original em
[src/hooks/use-auth.tsx](src/hooks/use-auth.tsx) e
[src/app/login.tsx](src/app/login.tsx).

## Regra importante da Apple

Se oferecermos Google e/ou Facebook no iOS, a Apple **exige** que também
ofereçamos "Entrar com a Apple" como opção equivalente (App Store Review
Guideline 4.8). Ou seja: Apple deixa de ser opcional assim que Google ou
Facebook entram no app para iOS. Por isso o botão da Apple já está
implementado junto com o do Google.

## O que já está no código

- `signInWithApple`, `signInWithGoogle`, `signInWithFacebook` em
  [src/hooks/use-auth.tsx](src/hooks/use-auth.tsx) — Apple via
  `expo-apple-authentication` + `supabase.auth.signInWithIdToken`; Google e
  Facebook via `expo-web-browser` + `supabase.auth.signInWithOAuth` (fluxo
  pelo navegador).
- Botões em [src/app/login.tsx](src/app/login.tsx): Apple (componente
  oficial, só iOS) e Google aparecem; o de Facebook fica comentado no JSX
  até o app dele sair do modo desenvolvimento na Meta.
- `profiles.needs_username` (ver `supabase/schema.sql`): login social não
  manda `@usuário`, então o trigger marca a flag e
  [src/app/choose-username.tsx](src/app/choose-username.tsx) pede um antes
  de liberar as abas (guarda em `src/app/(tabs)/_layout.tsx`).
- Pacotes já instalados: `expo-apple-authentication`, `expo-web-browser`,
  `expo-crypto`.

## Apple — já configurado ✅

- Capability "Sign In with Apple" habilitada no App ID
  `com.nagibneto.nextepisode` (Apple Developer).
- Provider Apple habilitado no Supabase, Client ID `com.nagibneto.nextepisode`.
- Chave usada para gerar o "Secret Key (for OAuth)" do Supabase:
  - **Key ID**: `KUVZS43LZ2`
  - **Team ID**: `C2KT64ST28`
  - **Arquivo .p8**: `keys/AuthKey_KUVZS43LZ2.p8` (local, fora do git — está
    em `.gitignore`; guarde uma cópia de backup fora do repo também, a Apple
    só deixa baixar uma vez).
  - **Gerado em**: 2026-08-05 — **expira em**: 2027-02-01 (180 dias, o
    máximo que a Apple aceita; o próprio Supabase mostra um aviso amarelo
    perto do vencimento).
  - **Para gerar um novo secret** (perto do vencimento, ou se precisar
    trocar de chave): `node scripts/generate-apple-secret.js "<caminho do .p8>" C2KT64ST28 KUVZS43LZ2 com.nagibneto.nextepisode`
    e colar o resultado em Supabase → Authentication → Providers → Apple →
    "Secret Key (for OAuth)".

## O que falta fazer (fora do código, só o usuário faz)

1. ~~**Apple Developer** → Identifiers → App ID `com.nagibneto.nextepisode` →
   habilitar "Sign In with Apple".~~ Feito (ver seção acima).
2. ~~**Supabase** → Authentication → Providers → Apple → habilitar, Client ID
   autorizado = `com.nagibneto.nextepisode`.~~ Feito (ver seção acima).
3. **Google Cloud Console** → OAuth consent screen + Client ID tipo Web →
   redirect URI = `https://SEU-PROJETO.supabase.co/auth/v1/callback`.
4. **Supabase** → Providers → Google → habilitar com Client ID/Secret do
   passo 3.
5. **Supabase** → Authentication → URL Configuration → Redirect URLs →
   adicionar `nextepisode://login`.
6. **Facebook Developers** (pode ficar para depois) → criar app → produto
   "Facebook Login" → mesma redirect URI do passo 3. Atenção: o app nasce em
   modo desenvolvimento, só loga devs/testers até passar por App Review.
7. **Supabase** → Providers → Facebook → habilitar com App ID/Secret (e
   descomentar o botão em login.tsx).
8. **Build de dev do EAS** (`eas build --profile development`) — os módulos
   nativos não rodam no Expo Go.

Ordem sugerida: 1–2 e 3–5 (Google+Apple) primeiro, em paralelo; 6–7
(Facebook) depois; 8 assim que Google e/ou Apple já estiverem configurados,
para já poder testar o que der.
