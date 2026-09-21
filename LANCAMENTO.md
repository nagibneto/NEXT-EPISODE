# Lançar uma versão nas lojas

Passo a passo de build e envio para App Store e Google Play. Para mudança só de
JS/assets, **não faça isso** — use `eas update` (ver `OTA-UPDATE.md`), que é
instantâneo e não passa por review.

Precisa de build quando a mudança é nativa: dependência nova com código nativo,
plugin novo em `app.json`, entitlement, permissão, `deploymentTarget`, ícone,
splash. A 1.0.7 é o exemplo: os widgets trouxeram `react-native-android-widget`,
`@bacons/apple-targets` e um App Group.

## Antes de começar

```bash
npx tsc --noEmit
npx eslint .
```

## 1. Subir o número da versão

`expo.version` no `app.json` — e **só ele**. `buildNumber` (iOS) e `versionCode`
(Android) são automáticos: `eas.json` usa `appVersionSource: "remote"` com
`autoIncrement: true` no perfil `production`.

> ⚠️ **Depois do bump, acabou o OTA para a versão anterior.** O
> `runtimeVersion` usa a política `appVersion`, então um `eas update` publicado
> com 1.0.7 no `app.json` só chega em quem já está na 1.0.7. Se ainda faltava
> mandar alguma correção de JS para a 1.0.6, mande **antes** de bumpar.

## 2. Build das duas lojas

```bash
eas build --platform all --profile production
```

Demora. Acompanhe em https://expo.dev/accounts/nagibn/projects/next-episode/builds.

## 3. Enviar

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

O `ascAppId` do App Store Connect já está no `eas.json`.

## 4. Preencher a ficha de cada loja

- **Notas da versão**: `store/notas-versao-<versão>.md`, nos dois idiomas. O
  Google Play corta em **500 caracteres por idioma**; a App Store aceita 4000.
- **Descrição**: `store/descricao-app-store.md`. Só precisa mexer quando a
  versão traz algo que valha para quem ainda não instalou.
- **Capturas de tela**: `store-assets/`.
- Confira também o **Age Rating** e o **App Privacy** se a versão mexeu em
  coleta de dados ou em anúncios.

## 5. Depois de aprovada nas duas lojas

Anuncie a versão no modal de atualização (ver `ATUALIZACAO-E-AVALIACAO.md`):
rode `supabase/queries/anunciar-<versão>.sql` no SQL Editor do Supabase.

> Na primeira vez, crie a tabela antes: o bloco `app_releases` do fim de
> `supabase/schema.sql` ainda não foi aplicado em produção.

**Só depois de a versão estar visível nas lojas.** Antes disso o modal manda a
pessoa para uma ficha que ainda mostra a versão velha.

Se uma loja aprovar dias antes da outra, use a coluna `platform` para anunciar
só onde já dá para atualizar — o arquivo de SQL tem a variante pronta.

## 6. Commitar

```bash
git commit -am "Versão <versão>: <o que mudou>"
git tag v<versão>
```

---

# Específico da 1.0.7

## O que vai nesta versão

- **Widgets de tela inicial**, iOS e Android (ver `WIDGETS.md`).
- Botão "Avalie-nos" no perfil.
- Toque na notificação do quiz abre a pergunta direto.
- Modais de atualização e de avaliação **prontos e desligados** por flag (ver
  `ATUALIZACAO-E-AVALIACAO.md`).

## ⚠️ Esta versão sobe o mínimo do iOS para 16.4

O `app.json` agora passa `deploymentTarget: "16.4"` ao `expo-build-properties`.
O padrão do React Native 0.81 é **15.1**, então a 1.0.7 deixa de ser oferecida
para quem está entre o iOS 15.1 e o 16.3 — a App Store simplesmente não mostra
a atualização para esses aparelhos. Eles continuam na 1.0.6, funcionando, e
continuam recebendo OTA enquanto houver publicação para aquele runtime.

Duas consequências práticas:

1. Vale conferir no App Store Connect (Analytics → Devices) quanta gente isso
   representa antes de enviar. Se for muita, dá para tentar baixar o alvo — os
   widgets com botão interativo é que pedem iOS mais novo.
2. **Nunca marque uma versão como `mandatory` sem checar isso.** Um modal
   obrigatório para quem não consegue atualizar trava o app sem saída.

## Os modais continuam desligados

`UPDATE_PROMPT_ENABLED` e `REVIEW_PROMPT_ENABLED` vão em `false` na 1.0.7. Isso
é de propósito: ligar é uma linha em cada arquivo e sai por `eas update` para o
runtime 1.0.7, sem build nova nem review de loja.

O modal de atualização **não vai aparecer neste lançamento** de qualquer forma:
quem está na 1.0.6 não tem o código dele instalado. Ele começa a valer da 1.0.8
em diante, para quem tiver a 1.0.7 ou mais.

O contador do pedido de avaliação, por outro lado, já roda com a flag
desligada — quando você ligar, quem usa o app entra elegível na hora.
