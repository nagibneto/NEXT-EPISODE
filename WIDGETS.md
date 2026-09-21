# Widgets

Widgets de tela inicial do Next Episode, nos dois sistemas. Em ambos é código
nativo: um widget **não roda JavaScript de tela**, então quem monta o conteúdo
é o app, que deixa tudo pronto num armazenamento compartilhado.

## O que existe

Um widget, em **dois tamanhos**. As setas ‹ › do cabeçalho trocam a seção:

| Seção | Tamanho médio | Tamanho pequeno |
| --- | --- | --- |
| **Assistir a seguir** | Os episódios que faltam assistir, na ordem da watchlist, cada um com o botão de marcar assistido. | O primeiro, com o botão em cápsula. |
| **Próximos episódios** | As estreias mais próximas, com a contagem ("Amanhã", "Em 5 dias"). | A mais próxima, com a contagem em destaque. |
| **Quiz do dia** | Situação, escalada atual, a semana em bolinhas (✓/✗, como no card do perfil) e o botão Responder. | O mesmo, com as bolinhas sem rótulo. |

Tocar numa linha abre o episódio no app; tocar no resto abre a tela da seção.
Tudo pelo esquema `nextepisode://`.

### Uma diferença entre os sistemas

No **iOS** a lista mostra 3 itens por vez e as setas paginam: o WidgetKit
desenha uma imagem estática e não rola, ponto final. No **Android** o
`ListWidget` rola de verdade, então as setas só trocam de seção e a lista
inteira fica acessível.

### Por que o botão de assistido é um anel vazio

O primeiro desenho era um círculo preenchido com um check colorido, e lia-se
como "este episódio já foi assistido" — o contrário da ação. Agora o estado
inicial é um anel apagado (o mesmo que a watchlist do app usa para "toque para
marcar") e só depois do toque vira o círculo cheio, com a linha esmaecida. No
tamanho pequeno o botão é uma cápsula com o verbo, "Marcar assistido", que
ninguém confunde com um selo de status.

## Como os dados chegam lá

```
app (JS)                                                   widget
──────────────────────────────────────────────────────────────────────────
buildWidgetPayload()   ──┐
  Supabase + TMDB + quiz ├─ escreve o payload (JSON)  ──▶  lê e desenha
  textos já traduzidos ──┘

                         ◀── lê a fila de pendentes  ◀──  botão de assistido
syncWidgetActions()
  → markEpisodeWatched no Supabase
  → avisa as telas (onWidgetWatchedSynced)
```

| | iOS | Android |
| --- | --- | --- |
| Transporte | App Group (`UserDefaults` compartilhado), via `ExtensionStorage` | AsyncStorage — a tarefa do widget roda no mesmo contexto JS do app |
| Desenho | Swift/SwiftUI em `targets/widgets/` | TSX em `src/widgets/`, serializado para RemoteViews |
| Ponte | `src/lib/widget-bridge.ios.ts` | `src/lib/widget-bridge.android.ts` |

Comum aos dois: `src/lib/widget-data.ts` (monta o payload e agenda as
publicações) e `src/hooks/use-widget-data.ts` (publica ao abrir as abas e nas
trocas de primeiro/segundo plano). O payload leva os textos **já traduzidos**
porque o widget não tem i18next nem sabe qual idioma foi escolhido dentro do
app; trocar o idioma no perfil republica tudo.

### Qual série entra na lista

A mesma regra da watchlist: só séries já começadas, ordenadas pela atividade
mais recente — o maior entre *o último episódio que você marcou como assistido*
e *o último que foi ao ar*. É isso que faz uma série antiga que você está
maratonando aparecer na frente de uma série em lançamento na qual você já está
em dia. Ordenar só pela data de estreia (como era na primeira versão) fazia
exatamente o contrário, e a lista vinha vazia.

### Marcar assistido

O widget não tem a sessão do Supabase, então o botão não grava direto: ele
enfileira a marcação, muda a linha na hora, e o app envia na próxima vez que
abrir (`syncWidgetActions`). O que falhar (sem rede) volta para a fila e tenta
de novo depois — a marcação não se perde.

Gravar no Supabase, porém, não basta: as telas já teriam carregado e
continuariam mostrando o episódio antigo até alguém puxar para atualizar. Quem
marcou pela tela inicial não tem motivo nenhum para imaginar isso. Por isso
`syncWidgetActions` avisa quem se inscreveu em `onWidgetWatchedSynced`, e a
watchlist e a tela do episódio se corrigem sozinhas.

> No Android daria para gravar direto do widget, já que a tarefa roda no
> contexto JS do app. Não fazemos porque a sessão pode não estar restaurada com
> o app fechado, e uma marcação perdida é pior do que uma marcação que demora.

## Como compilar e testar

Widget **não sai por OTA update** em nenhum dos dois: é código nativo novo.

```sh
# iOS — obrigatoriamente na nuvem, o projeto é desenvolvido no Windows
eas build --profile development --platform ios

# Android — dá para rodar local, com Android SDK instalado
npx expo run:android
# ou, sem SDK local:
eas build --profile development --platform android
```

Depois de instalar: **abra o app e deixe a watchlist carregar** — é essa
abertura que publica os dados. Só então adicione o widget (segure um espaço
vazio da tela inicial → widgets → Next Episode).

### Requisitos

- **iOS 17+** para o widget aparecer. `Button(intent:)` e `containerBackground`
  só existem a partir daí; em iPhones mais antigos o app funciona igual, sem
  widget.
- **iOS 16.4+ para o app inteiro**, via `expo-build-properties` em `app.json`.
  Não é escolha de design: o podspec do `ExtensionStorage` (o módulo nativo que
  o app usa para escrever no App Group) declara `s.platform = :ios, '16.4'`, e
  o autolinking do Expo **pula em silêncio** todo pod que não suporte a
  plataforma do alvo — só imprime um aviso amarelo no `pod install` e segue.
  Com o padrão de 15.1 o build passa, o widget aparece na galeria (isso vem do
  config plugin, que não depende de pods) e o módulo simplesmente não existe em
  tempo de execução: toda escrita vira no-op e o widget fica eternamente vazio.
  Ver `expo-modules-autolinking/scripts/ios/autolinking_manager.rb`, por volta
  da linha 60.
- **`"use no memo";` no topo dos arquivos de `src/widgets/`.** O projeto tem o
  React Compiler ligado (`experiments.reactCompiler`), e o
  react-native-android-widget precisa das funções de componente cruas para
  percorrer a árvore JSX — memoizadas, ele morre com "Invalid Hook Call". Ao
  criar um arquivo novo de widget, repita a diretiva.
- macOS/Xcode **não** são necessários para publicar, mas sem eles não dá para
  usar o preview do SwiftUI: cada ajuste visual do iOS custa um build da EAS.
  O Android não tem esse problema — `npx expo run:android` roda no Windows.

## Limitações conhecidas

- **Nomes na galeria de widgets em português.** No iOS, os títulos e descrições
  que o sistema mostra ao adicionar (`configurationDisplayName` /
  `description`) estão fixos em pt-BR. Traduzir exige um `Localizable.strings`
  dentro do target.
- **Sem imagem de pré-visualização no Android** (`previewImage`): a galeria
  mostra um preview genérico. Resolve-se adicionando um PNG ao plugin.
- **Horário da estreia.** A TMDB informa só o dia, então a contagem é até a
  meia-noite local. Por isso as horas só aparecem quando falta menos de 6h —
  antes disso "Amanhã" é mais honesto que "Em 19h".
- **Publicação ao ir para o segundo plano** é melhor esforço: o sistema
  suspende o JS em poucos segundos. Se não der tempo, o widget atualiza na
  abertura seguinte.
- **Poucas estreias marcadas** deixa a seção "Próximos episódios" vazia — e
  isso está certo. Ela depende do `next_episode_to_air` da TMDB, que só existe
  para séries com data anunciada; compare com a aba **Próximos** do app.
- **No máximo dois `ListWidget`** por widget no Android, e nunca um dentro do
  outro — a própria biblioteca valida isso e lança erro.
- **Latência do toque no Android.** O toque numa seta ou no botão de assistido
  acorda uma tarefa JS headless, e isso nunca é instantâneo. Em build de
  desenvolvimento é bem pior, porque o bundle vem do Metro pela rede; em build
  de produção ele já está embutido no app.

### Cartazes no Android precisam estar em disco

A biblioteca **não tem cache de imagem**: ao desenhar, ela baixa toda URL
remota por HTTP, de forma síncrona, antes de montar a tela — e como
desenhamos tema claro e escuro, era um download por cartaz **vezes dois**, a
cada toque de seta. Por isso `src/widgets/poster-cache.ts` baixa os cartazes
uma vez para o diretório de cache e o payload do Android guarda `file://` em
vez de `https://`; o lado nativo então usa `BitmapFactory.decodeFile` e não
toca na rede (ver `ResourceUtils.getBitmap` na biblioteca).

Ao mexer no desenho do widget, não volte a passar URL remota para o
`ImageWidget` — funciona, mas devolve a lentidão.

## Ao mexer

- Mudou o formato do payload? Suba o `version` em `src/lib/widget-data.ts` **e**
  a checagem em `SharedData.swift` / `src/widgets/storage.ts` — o widget
  descarta o que não sabe ler, em vez de desenhar errado. Campos novos entram
  como opcionais no Swift: um campo obrigatório que o app antigo não manda
  derruba a decodificação inteira por causa de um detalhe.
- Em build de desenvolvimento, `publishWidgetData` imprime no terminal do Metro
  `[widget] publicado: N estreias, M para assistir — <estado da gravação>`. O
  final da linha é o que separa "faltou dado" de "a escrita não funcionou" —
  foi a ausência dessa verificação que escondeu, por dois builds, um módulo
  nativo que nunca tinha entrado no app.
- O estado vazio do widget diz de qual caso se trata: *"Você está em dia"* /
  *"Nenhuma estreia marcada"* (chegou o JSON, a lista é que está vazia),
  *"Sem dados ainda · Abra o Next Episode"* (nada no armazenamento) ou
  *"Sem dados ainda · Atualize o Next Episode"* (formato incompatível).
- O App Group aparece em três lugares: `app.json`,
  `targets/widgets/expo-target.config.js` e `src/lib/widget-bridge.ios.ts`.
- O `index.js` da raiz existe só para registrar a tarefa do widget do Android
  antes de qualquer tela montar. O `main` do `package.json` aponta para ele, e
  não mais direto para `expo-router/entry`.
- `npx expo prebuild --platform android` roda no Windows e valida o config
  plugin sem gastar build. O do iOS só roda em macOS/Linux.
