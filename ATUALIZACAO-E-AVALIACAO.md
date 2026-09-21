# Modal de atualização e pedido de avaliação

Dois avisos de abertura, prontos e **desligados**. Ficam montados em
`src/app/(tabs)/_layout.tsx` e entram na mesma fila dos outros avisos
(`src/lib/startup-prompts.ts`), então nunca caem por cima do modal do quiz.

Ligar os dois é mudança só de JS — sai por `eas update`, sem build nova.

## 1. Modal "tem versão nova"

| Arquivo | Papel |
| --- | --- |
| `src/lib/app-update.ts` | Flag, consulta e regra de "aparece ou não" |
| `src/lib/app-version.ts` | Versão instalada + comparação de versões |
| `src/components/update-prompt.tsx` | A tela |
| `src/locales/*/update.json` | Textos |
| `public.app_releases` (`supabase/schema.sql`) | Lista de versões e melhorias |

### Por que a lista de versões fica no banco

O app instalado só conhece o próprio changelog: quem está na 1.0.6 não tem como
saber o que mudou na 1.0.7. E OTA update não resolve, porque `runtimeVersion`
usa a política `appVersion` — um update publicado com a 1.0.7 no `app.json` só
chega em quem já está na 1.0.7.

Por isso a tabela `app_releases`: o app compara `expo.version` com o que estiver
lá e monta "o que há de novo **desde a sua versão**" (junta as melhorias de
todas as versões pendentes, não só da última).

### Quando ele começa a valer

A partir da **1.0.8**. Quem está na 1.0.6 não tem o código do modal instalado,
então o lançamento da 1.0.7 (a primeira versão que o traz) passa sem aviso
nenhum — não há como um app avisar sobre um recurso que ele não tem.

### Como anunciar um lançamento

Depois de a build **ser aprovada e aparecer na loja**, rode o
`supabase/queries/anunciar-<versão>.sql` no SQL Editor. O formato é este:

```sql
insert into public.app_releases (version, highlights) values (
  '1.0.7',
  '{
    "pt-BR": ["Widgets na tela de início", "Busca mais rápida"],
    "en-US": ["Home screen widgets", "Faster search"]
  }'::jsonb
);
```

Inserir antes da aprovação manda todo mundo para uma loja que ainda mostra a
versão velha. O passo a passo completo do lançamento está em `LANCAMENTO.md`.

Colunas extras:

- `platform` (`'ios'` / `'android'`): use quando a review de uma loja atrasar e
  a versão sair só de um lado. `null` = as duas.
- `mandatory`: tira o "agora não" e o toque fora do cartão — a única saída é ir
  para a loja. Só para quebra de compatibilidade de verdade, e **nunca sem
  antes conferir o mínimo de iOS/Android da versão**: quem estiver num aparelho
  que a loja não oferece a atualização ficaria com o app travado sem saída (a
  1.0.7, por exemplo, exige iOS 16.4 — ver `LANCAMENTO.md`).

### Comportamento

- Uma consulta por sessão do app.
- "Agora não" some por 3 dias (`SNOOZE_DAYS`), guardado no aparelho e não na
  conta — atualizar é por aparelho, e quem tem celular e tablet precisa ver o
  aviso nos dois.
- Lista no máximo 3 versões / 8 melhorias (`MAX_VERSIONS`, `MAX_HIGHLIGHTS`).
- Consulta que falha não mostra nada: aviso de atualização não vale uma tela de
  erro.

### Ligar

`UPDATE_PROMPT_ENABLED = true` em `src/lib/app-update.ts`.

## 2. Modal "avalie o app"

| Arquivo | Papel |
| --- | --- |
| `src/lib/app-review.ts` | Flag e regra de quando pedir |
| `src/components/review-prompt.tsx` | A tela |
| `src/locales/*/review.json` | Textos |

### Quando aparece

O pedido vem depois de um momento bom, nunca no primeiro contato — pedir nota
para quem acabou de instalar é o caminho mais curto para uma estrela. Cada
episódio marcado como assistido conta um "momento" (`registerReviewMoment()`,
chamado de `markEpisodeWatched` em `src/lib/db.ts`).

- 15 momentos para o primeiro pedido (`MOMENTS_BEFORE_FIRST_ASK`).
- Recusou? +40 momentos e no mínimo 60 dias para a próxima
  (`MOMENTS_PER_EXTRA_ASK`, `DAYS_BETWEEN_ASKS`).
- No máximo 3 pedidos na vida do app no aparelho (`MAX_ASKS`).
- Tocou em "Avaliar": nunca mais. Não dá para saber se a pessoa deixou mesmo a
  nota (nenhuma loja conta isso de volta), e insistir com quem já avaliou é
  pior do que perder uma avaliação.

Com o modal de atualização ligado, o pedido de nota se cala enquanto houver
versão nova esperando: pedir 5 estrelas de uma versão velha — e na mesma
abertura em que o outro modal pede para atualizar — é o pior dos dois mundos.
Os dois compartilham a mesma consulta (`pendingUpdateOnce()`).

O contador roda mesmo com a flag desligada — assim, no dia em que ligar, quem
já usa o app entra elegível na hora em vez de ter que recomeçar do zero.

### Para onde o botão leva

`openStoreReview()` (`src/lib/store-links.ts`), o mesmo do botão "Avalie-nos" do
perfil: App Store direto no formulário de nota, Play Store na ficha do app.

Não usamos o pop-up nativo de 1–5 estrelas (`SKStoreReviewController` /
`expo-store-review`) porque ele exige dependência nativa nova — ou seja, build e
review de loja, e o aviso deixa de ser ligável por OTA.

### Ligar

`REVIEW_PROMPT_ENABLED = true` em `src/lib/app-review.ts`.

## Testar antes de soltar

1. Ligue a flag do que quiser testar.
2. **Atualização**: insira em `app_releases` uma versão maior que a do
   `app.json` (ex.: `'9.9.9'`) e reabra o app. Para repetir depois do "agora
   não", limpe `app-update-prompt:snoozed-until` do AsyncStorage (ou reinstale).
3. **Avaliação**: baixe `MOMENTS_BEFORE_FIRST_ASK` para 1 temporariamente, marque
   um episódio e reabra o app.
4. Apague a linha de teste de `app_releases` e devolva as constantes ao valor
   original.
