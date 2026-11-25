# Aba Games (IGDB)

Branch `games_deploy`. Os games vêm da [IGDB](https://www.igdb.com) (da Twitch),
que é grátis para uso **não comercial**. Se o app passar a ter anúncios ou
premium, é preciso pedir antes uma parceria comercial à IGDB (contato na
documentação deles: https://api-docs.igdb.com).

## Como funciona

- **Modo Games**: o seletor 📺 | 🎮 no header das abas
  ([ModeToggle](src/components/app-header.tsx), estado em
  [use-app-mode](src/hooks/use-app-mode.tsx), lembrado entre aberturas) troca
  o conteúdo das abas: Início → home de games, Watchlist → **Biblioteca**,
  Para você → indicações de games, Buscar → busca de games. Feed e Perfil não
  mudam. As telas de games ficam em `src/components/game-*-view.tsx`.

```
App ──► Edge Function `igdb` (Supabase) ──► api.igdb.com
         guarda o Client Secret da Twitch,
         gera/renova o token e faz cache
```

- O app **nunca** fala direto com a IGDB: o Client Secret não pode ir dentro
  do app. Ele só pede ações fechadas (`search`, `list`, `details`) para a
  function [supabase/functions/igdb](supabase/functions/igdb/index.ts), e
  só usuários logados conseguem chamar.
- A coleção (Quero jogar / Jogando / Zerei / Abandonei) fica na tabela
  `game_library`. Nome e capa são gravados junto, então a lista abre sem
  consultar a IGDB.
- Nota e comentários usam as mesmas tabelas de filmes e séries
  (`episode_ratings` / `episode_comments`), com `media_type = 'game'` e o id
  da IGDB no lugar do id da TMDB. Curtidas, respostas, denúncias, spoiler e
  bloqueio funcionam sem mudança nenhuma.
- Os comentários ficam cobertos (podem ter spoiler) até a pessoa marcar
  Jogando, Zerei ou Abandonei. Também dá pra abrir com "Mostrar mesmo assim".

## Passo a passo para ligar

1. **Criar o app na Twitch**: entre em https://dev.twitch.tv/console/apps
   → *Register Your Application*.
   - Name: `Next Episode` (ou qualquer um)
   - OAuth Redirect URLs: `https://nextepisode.com.br` e clique em **Add**
     (a Twitch exige HTTPS; o endereço não é usado, a IGDB não faz login de
     usuário)
   - Category: *Application Integration*
   - Client Type: **Confidential**
   - Depois clique em *Manage* → copie o **Client ID** e gere um **New Secret**.
   - A conta da Twitch precisa ter a verificação em duas etapas ligada.

2. **Guardar as credenciais no Supabase** (Dashboard → Edge Functions →
   Secrets, ou pela CLI):
   ```
   npx supabase secrets set TWITCH_CLIENT_ID=xxxx TWITCH_CLIENT_SECRET=yyyy
   ```

3. **Publicar a function**:
   ```
   npx supabase functions deploy igdb
   ```

4. **Preparar o banco**: rode
   [supabase/queries/games-setup.sql](supabase/queries/games-setup.sql) no SQL
   Editor. Pode rodar com o app antigo no ar: o script só cria uma tabela nova
   e libera `'game'` nas notas e comentários.

5. Rodar o app (`npx expo start`) e abrir a aba **Games**.

## Limites da IGDB

- 4 requisições por segundo e no máximo 8 ao mesmo tempo. Não há limite
  mensal.
- A function guarda em memória as listas (30 min), os detalhes (6 h) e as
  buscas (10 min). O app guarda mais 15 min por sessão. Se um dia a cota
  apertar, o próximo passo é gravar esse cache numa tabela do Supabase.

## Limitações conhecidas

- A IGDB praticamente só tem descrição em inglês. A tela avisa isso em pt-BR.
- Games ainda não aparecem no feed dos amigos, nos favoritos, nas
  estatísticas nem no perfil. A tabela já permite que amigos leiam a coleção,
  para isso vir depois.

## Steam (conquistas e horas)

A pessoa vincula a Steam em **Perfil → Conexões → Contas de games**. Ela só
digita o nome da URL personalizada, o link do perfil ou o SteamID, sem login
e sem senha. O app mostra o perfil encontrado ("É você?") antes de vincular.

- **O que aparece**: na tela de cada jogo que existe na Steam, um card "Na sua
  Steam" com as horas jogadas, a data da última vez, a barra de conquistas e
  as 4 últimas conquistas.
- **Sincronização automática** ([steam-sync.ts](src/lib/steam-sync.ts)):
  quando uma tela do modo Games ganha foco, os jogos abertos na Steam desde a
  última sincronização entram na Biblioteca como **Jogando**. Isso acontece no
  máximo a cada 30 minutos; puxar para atualizar força na hora. Jogos que já
  estão na Biblioteca não mudam, e um jogo removido só volta se for jogado de
  novo. Na primeira vez (e no botão "Sincronizar agora") entra tudo das
  últimas 2 semanas.
- **Perfil privado** na Steam: nada aparece, por escolha da pessoa. A tela
  explica como abrir o perfil.
- **Peças**: Edge Function [steam](supabase/functions/steam/index.ts) com a
  chave da API, tabela `linked_game_accounts` e, na function `igdb`, o
  `steamAppId` do jogo (via `external_games` da IGDB) e a ação `steamLookup`.

### Como ligar

1. **Chave da Steam**: entre em https://steamcommunity.com/dev/apikey com uma
   conta Steam. A conta precisa ter o Steam Guard ativo e não pode ser
   "limitada", ou seja, já precisa ter gastado pelo menos US$ 5 na Steam.
   Em Domain, coloque `nextepisode.com.br`. O limite é de 100 mil chamadas
   por dia.
2. **Secret**: `npx supabase secrets set STEAM_API_KEY=xxxx`
3. **Deploy das duas functions** (a `igdb` mudou):
   ```
   npx supabase functions deploy igdb
   npx supabase functions deploy steam
   ```
4. **Banco**: rode [supabase/queries/steam-setup.sql](supabase/queries/steam-setup.sql)
   no SQL Editor.

**Política de privacidade**: o app passa a guardar o SteamID e o nome/avatar
públicos da conta vinculada. Antes de lançar, isso precisa entrar na política
(docs/privacy.html) e no App Privacy / Data Safety.

## PlayStation (troféus) — API NÃO oficial

A Sony não tem API pública. A function [psn](supabase/functions/psn/index.ts)
usa os mesmos endpoints do app oficial da PlayStation (igual à biblioteca
`psn-api`, ao PSNProfiles e ao Exophase). **Pode parar de funcionar sem
aviso**, por isso a tela marca a integração como "experimental".

- Uma **conta robô** da PSN faz as consultas. Crie uma conta só pra isso e
  nunca use a sua conta pessoal.
- O usuário só digita o **ID online**. Os troféus aparecem se a privacidade
  dele permitir: Troféus visíveis para "Qualquer pessoa".
- **Tela do jogo** (só jogos lançados em PlayStation): card "Na sua
  PlayStation" com o progresso, a contagem de platina, ouro, prata e bronze e
  os últimos troféus. O jogo é achado **pelo nome**, porque a PSN não tem id
  em comum com a IGDB.
- **Sincronização**: entra na mesma rotina da Steam
  ([game-sync.ts](src/lib/game-sync.ts)). Jogos em que a pessoa ganhou troféu
  desde a última vez entram como **Jogando**, casados com a IGDB pelo nome
  (ação `matchNames` da function `igdb`). Só entra quando o nome bate
  exatamente; melhor não importar do que importar o jogo errado.

### Como ligar

1. **Crie a conta robô** em https://www.playstation.com, com outro e-mail.
   Não precisa ter console.
2. **Pegue o NPSSO**:
   - entre em https://www.playstation.com logado com a conta robô;
   - na mesma aba, abra https://ca.account.sony.com/api/v1/ssocookie;
   - copie o valor de `"npsso"` (64 caracteres).
3. **Secret**: coloque o valor no `.env` como `PSN_NPSSO` e rode:
   ```powershell
   $k = (Get-Content .env | Where-Object { $_ -match '^PSN_NPSSO=' }) -replace '^PSN_NPSSO=', '' -replace '"', ''
   npx supabase secrets set "PSN_NPSSO=$k"
   ```
4. **Banco**: rode [supabase/queries/psn-setup.sql](supabase/queries/psn-setup.sql),
   que cria a tabela `service_tokens`, onde ficam os tokens da conta robô.
5. **Deploy**:
   ```
   npx supabase functions deploy igdb
   npx supabase functions deploy psn
   ```

**Renovação**: o NPSSO e o refresh token duram cerca de 2 meses. Quando
vencerem, o app mostra "A conexão com a PlayStation precisa ser renovada".
Repita os passos 2 e 3, e rode no SQL Editor
`delete from service_tokens where service = 'psn';` para a function gerar
tokens novos.

## Xbox (conquistas) — API NÃO oficial

A function [xbox](supabase/functions/xbox/index.ts) usa os serviços do próprio
Xbox Live, os mesmos do app do Xbox e do xbox.com, como fazem as bibliotecas
`xbox-webapi` e `xboxreplay`. Pode quebrar sem aviso e aparece como
"experimental". O OpenXBL foi descartado: os termos não permitem uma chave
servindo vários usuários, e o plano grátis é de só 150 req/h.

- Uma **conta Microsoft robô** entrou **uma vez** pelo login oficial da
  Microsoft, no app "Next Episode Xbox" registrado no Azure. O refresh token
  se renova sozinho a cada uso e fica guardado em `service_tokens`.
- O usuário digita a **gamertag**. Conquistas e jogos aparecem se o histórico
  de jogos dele estiver visível para "Todos".
- **Tela do jogo** (jogos de Xbox ou PC): card "No seu Xbox" com as
  conquistas, o Gamerscore, a última vez que jogou e as últimas conquistas. O
  jogo é achado pelo nome ([_shared/names.ts](supabase/functions/_shared/names.ts)).
- **Sincronização**: jogos abertos no Xbox desde a última vez entram como
  **Jogando**.

### Como ligar

1. **App no Azure**: o "Next Episode Xbox" já está registrado, com ID
   `02c79466-8ccc-44d5-b0d2-765e55bcfd5d`, apenas contas pessoais e
   redirecionamento `https://login.microsoftonline.com/common/oauth2/nativeclient`
   como cliente público. Em Authentication, "Permitir fluxos de clientes
   públicos" precisa estar em **Sim** (ou `"allowPublicClient": true` no
   Manifesto).
2. **Conta robô**: uma conta Microsoft de adulto, que já tenha entrado uma vez
   em https://www.xbox.com para criar o perfil Xbox.
3. **Login único**: `node scripts/xbox-login.mjs`. Ele mostra um link; entre
   com a conta robô e cole de volta o endereço da página em branco. O script
   grava `XBOX_CLIENT_ID` e `XBOX_REFRESH_TOKEN` no `.env`, sem mostrar o
   token, e imprime o comando dos secrets.
4. **Secrets e deploy**: rode os comandos que o script imprime, mais
   `npx supabase functions deploy xbox`. A tabela `service_tokens` é a mesma
   da PSN ([psn-setup.sql](supabase/queries/psn-setup.sql)).

**Se parar de funcionar** ("A conexão com o Xbox precisa ser renovada"): rode
o passo 3 de novo, atualize o secret `XBOX_REFRESH_TOKEN` e apague a linha
antiga com `delete from service_tokens where service = 'xbox';`.

## Importar o histórico completo

A sincronização automática só traz o que é **novo**. Na primeira vez, isso são
os últimos 14 dias. Para trazer **a vida toda**, cada conta em Contas de games
tem o botão **"Importar histórico completo"**, que também é oferecido logo
depois de vincular ([importFullHistory](src/lib/game-sync.ts)):

| Situação do jogo na plataforma | Status na Biblioteca |
|---|---|
| 100% das conquistas (Xbox), platina ou 100% (PSN) | Zerei |
| Jogado nos últimos 30 dias | Jogando |
| O resto | **Joguei** (status novo, `played`) |

- **Steam**: entra todo jogo com tempo de jogo maior que zero. A Steam não
  marca "Zerei" na importação, porque saber se o jogo tem 100% das conquistas
  custaria uma chamada por jogo.
- Jogos que já estão na Biblioteca **não mudam**. Se o mesmo jogo aparecer em
  PS4 e PS5, fica o melhor status.
- O casamento com a IGDB é feito em lotes: 200 appIds da Steam por chamada,
  40 nomes da PSN ou do Xbox por chamada. A tela mostra o andamento.
- **Banco**: o status `played` precisa de
  [games-history-setup.sql](supabase/queries/games-history-setup.sql).

## Interruptor remoto (desligar uma plataforma sem versão nova)

A tabela `game_platforms` ([game-platforms-setup.sql](supabase/queries/game-platforms-setup.sql))
liga e desliga cada integração. Desligada, a plataforma some do app na hora:
o card em Contas de games, o card na tela do jogo e a sincronização
([game-platforms.ts](src/lib/game-platforms.ts)). As functions `psn` e `xbox`
também param de consultar, inclusive para versões antigas do app.

```sql
-- desligar (ex.: conta robô bloqueada, reclamação da Sony/Microsoft)
update public.game_platforms set enabled = false, updated_at = now() where platform = 'psn';
-- religar
update public.game_platforms set enabled = true, updated_at = now() where platform = 'psn';
```

Se a tabela não existir ou a consulta falhar, tudo fica **ligado**: o
interruptor serve para desligar de propósito, não para esconder por erro.

## Conteúdo adulto

A function `igdb` tira de tudo que o app mostra (busca, listas, "parecidos",
detalhe e importações) os jogos com o tema 42 da IGDB ("Erotic"). Muitos têm
capa explícita, e a App Store proíbe esse conteúdo (regra 1.1.4), mesmo com a
classificação 16+.
