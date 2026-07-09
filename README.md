# 📺 Next Episode

Aplicativo mobile (Android/iOS) no estilo TV Time: acompanhe as séries que você assiste,
marque episódios como assistidos, dê notas, comente com outros usuários e receba
notificações quando um novo episódio for lançado.

## Stack

| Camada | Tecnologia |
| --- | --- |
| App | [Expo](https://expo.dev) (React Native + TypeScript + expo-router) |
| Dados de séries | [TMDB API](https://developer.themoviedb.org) (busca, episódios, datas de estreia) |
| Backend | [Supabase](https://supabase.com) (autenticação, notas, comentários, séries seguidas) |
| Notificações | expo-notifications (locais) + Expo Push via Edge Function com cron (remotas) |

## Configuração (faça uma vez)

### 1. Chave da TMDB

1. Crie uma conta gratuita em <https://www.themoviedb.org>.
2. Vá em **Configurações → API** e solicite uma chave (uso pessoal/desenvolvedor).
3. Copie o valor de **"Chave da API"** (API Key v3).

### 2. Projeto no Supabase

1. Crie um projeto gratuito em <https://supabase.com/dashboard>.
2. Abra o **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql)
   e execute — isso cria as tabelas (perfis, séries seguidas, episódios assistidos,
   notas e comentários) com as políticas de segurança (RLS).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. (Opcional, recomendado para testar) Em **Authentication → Providers → Email**,
   desative "Confirm email" para conseguir entrar logo após o cadastro.
5. Se deixar "Confirm email" ativado: em **Authentication → URL Configuration**,
   adicione `nextepisode://*` em **Redirect URLs**. Sem isso, o link do e-mail de
   confirmação abre uma página de erro/em branco (a confirmação acontece do mesmo
   jeito, mas o app não recebe o usuário de volta).

### 3. Variáveis de ambiente

```bash
# na raiz do projeto
cp .env.example .env
```

Preencha o `.env` com as três chaves obtidas acima. O arquivo `.env` está no
`.gitignore` e não vai para o repositório.

## Rodando o app

```bash
npm install
npx expo start
```

- **Celular físico**: instale o app **Expo Go** (Android/iOS) e escaneie o QR code.
- **Emulador Android**: pressione `a` no terminal do Expo.
- **Simulador iOS** (somente macOS): pressione `i`.

> ⚠️ Notificações: no Expo Go as notificações locais funcionam no Android;
> no iOS é necessário um development build (`npx expo run:ios`). Para builds
> de produção use `eas build`.

## Funcionalidades

- **Minhas Séries** — grade com as séries que você segue.
- **Buscar** — busca na TMDB (com séries populares como sugestão inicial).
- **Próximos** — calendário dos próximos episódios das suas séries, ordenado por data.
- **Série** — sinopse, temporadas, próximo episódio e botão seguir/deixar de seguir.
- **Temporada** — lista de episódios com check de "assistido".
- **Episódio** — sua nota (1 a 10, em estrelas), média da comunidade e comentários.
- **Feed** — atividade dos amigos que você segue: episódios assistidos e comentários.
- **Amigos** — busque usuários por nome de usuário ou apelido e mande um pedido de
  amizade; a outra pessoa vê o pedido em Amigos e precisa aceitar para a conexão
  virar mútua (Perfil → Encontrar amigos).
- **Perfil** — apelido editável (é o nome que aparece para os outros), contadores, atalhos e exclusão de conta.
- **Estatísticas** — tempo total assistido (meses/dias/horas, estilo TV Time) e as
  séries que mais consumiram seu tempo.
- **Notificações locais** — ao abrir o app ou seguir uma série, agenda notificações
  para as 9h do dia de lançamento de cada próximo episódio.
- **Notificações remotas (push)** — uma Edge Function roda 1x por dia e envia push
  via Expo para os episódios que estreiam no dia, mesmo com o app fechado (veja abaixo).

## Push notifications remotas (opcional)

Para receber notificação de episódio novo mesmo com o app fechado há dias:

1. **EAS**: rode `npx eas init` para vincular o projeto ao EAS (isso adiciona o
   `extra.eas.projectId` no `app.json` — necessário para gerar o Expo Push Token).
2. **Development build**: push remoto não funciona no Expo Go (Android, SDK 53+).
   Gere um build com `npx expo run:android` ou `eas build`. No Android, configure
   as credenciais FCM no EAS (`eas credentials`) — a Expo usa o FCM para entregar o push.
3. **Reaplique o schema**: rode o [`supabase/schema.sql`](supabase/schema.sql) atualizado
   no SQL Editor (cria a tabela `push_tokens` e as demais novidades).
4. **Deploy da função**:
   ```bash
   supabase functions deploy notify-new-episodes --no-verify-jwt
   supabase secrets set TMDB_API_KEY=SUA_CHAVE_TMDB
   ```
5. **Cron diário**: no painel do Supabase (Integrations → Cron) agende a função
   `notify-new-episodes` para rodar 1x por dia — ou use o snippet pg_cron comentado
   no fim do `schema.sql`.

O app registra o push token do aparelho automaticamente ao abrir a aba
"Minhas Séries" (e o remove ao sair da conta).

## Exclusão de conta (obrigatório pelas lojas)

Apps com cadastro precisam oferecer exclusão de conta dentro do app e uma
forma de solicitar isso mesmo sem acesso ao app. No Next Episode:

- **No app**: Perfil → Excluir conta.
- **Fora do app**: instruções em [`docs/privacy.html`](docs/privacy.html)
  (a política de privacidade, publicada via GitHub Pages).

A exclusão roda na Edge Function `delete-account`, que apaga o usuário em
`auth.users` (cascateando perfil, séries, episódios, notas, comentários,
amizades e push tokens) e remove as mídias dele no bucket `comment-media`.

Deploy:
```bash
supabase functions deploy delete-account
```
(sem `--no-verify-jwt` — a função precisa validar quem está chamando.)

## Estrutura do código

```
src/
  app/                      # rotas (expo-router)
    (tabs)/                 # abas: Minhas Séries, Buscar, Próximos, Feed, Perfil
    show/[id]/              # detalhes da série e temporadas
    episode/[showId]/...    # tela do episódio (nota + comentários)
    login.tsx               # login / cadastro (com apelido)
    friends.tsx             # buscar e seguir usuários
    stats.tsx               # estatísticas de tempo assistido
  components/               # componentes visuais reutilizáveis
  hooks/                    # use-auth (sessão Supabase), use-theme
  lib/
    tmdb.ts                 # cliente da API TMDB (com cache de detalhes)
    supabase.ts             # cliente Supabase
    db.ts                   # consultas ao banco (seguir, notas, feed, tokens…)
    notifications.ts        # notificações locais + registro do push token
supabase/
  schema.sql                # tabelas + políticas RLS (rodar no SQL Editor)
  functions/
    notify-new-episodes/    # Edge Function de push remoto (cron diário)
    delete-account/         # Edge Function de exclusão de conta
docs/
  privacy.html              # política de privacidade (publicada via GitHub Pages)
eas.json                    # perfis de build (development, preview, production)
```

## Próximos passos sugeridos

- Reações e respostas nos comentários do feed.
- Perfil público de amigo (ver as séries que ele segue).
- Recomendação de séries com base no que os amigos assistem.

---

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
