# Premium e anúncios — passos manuais

O código do premium (assinatura via RevenueCat), do rewatch, dos avatares
exclusivos e dos anúncios (AdMob) já está no app. Este documento lista o que
precisa ser feito **fora do código** para tudo funcionar, na ordem.

## 1. Banco (Supabase)

Execute o `supabase/schema.sql` de novo no SQL Editor do painel (ele é
idempotente). Isso cria:

- `profiles.is_premium` e `profiles.premium_expires_at` (o cliente não
  consegue escrevê-las; só o webhook, com service_role);
- `watch_count` em `watched_episodes` e `watched_movies`;
- os RPCs `rewatch_episodes` / `rewatch_movie` e os triggers que bloqueiam
  rewatch e avatar premium para quem não assina.

## 2. App Store Connect

1. **Paid Apps Agreement**: em Business, aceite o contrato de apps pagos e
   preencha dados bancários e fiscais. Sem isso nada funciona, nem em sandbox.
2. **Assinaturas**: em App → Monetização → Assinaturas, crie um grupo
   (ex.: "Premium") com dois produtos auto-renováveis:
   - `premium_monthly` (1 mês)
   - `premium_yearly` (1 ano, com desconto)
   Preencha nome, preço e a descrição em pt-BR de cada um.
3. **Sandbox tester**: em Users and Access → Sandbox, crie um usuário de
   teste para testar compras no aparelho sem cobrar de verdade.

## 3. RevenueCat (https://app.revenuecat.com)

1. Crie o projeto e adicione o app iOS (bundle id `com.nagibneto.nextepisode`).
   Conecte com a App Store Connect API (key .p8) para sincronizar os produtos.
2. **Entitlement**: crie um entitlement com identificador exatamente
   `premium` (o app procura por esse id — `PREMIUM_ENTITLEMENT_ID`).
3. **Products/Offering**: importe `premium_monthly` e `premium_yearly`,
   anexe os dois ao entitlement `premium` e monte a offering **default** com
   os pacotes `$rc_monthly` e `$rc_annual` (a tela de paywall usa a offering
   "current").
4. **API key**: copie a chave pública iOS (Project Settings → API Keys) para
   o `.env`:
   `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_...`
5. **Webhook**: em Integrations → Webhooks, aponte para
   `https://SEU-PROJETO.supabase.co/functions/v1/revenuecat-webhook` com um
   Authorization header secreto. Depois faça o deploy da função:

   ```sh
   supabase secrets set REVENUECAT_WEBHOOK_AUTH="mesmo-valor-do-header"
   supabase functions deploy revenuecat-webhook --no-verify-jwt
   ```

## 4. AdMob (https://apps.admob.com)

1. Crie o app iOS no AdMob e copie o **App ID** (formato
   `ca-app-pub-XXXX~YYYY`). Troque no `app.json`, no plugin
   `react-native-google-mobile-ads` — os que estão lá são os **de teste do
   Google** e não geram receita.
2. Crie uma unidade de **banner** e copie o id (`ca-app-pub-XXXX/ZZZZ`) para
   o `.env`: `EXPO_PUBLIC_ADMOB_BANNER_IOS=...`
   (em `__DEV__` o app sempre usa o banner de teste, então isso só importa no
   build de produção).
3. O app serve **apenas anúncios não personalizados**
   (`requestNonPersonalizedAdsOnly`), então não há prompt de rastreamento
   (ATT). Se um dia quiser anúncios personalizados, será preciso adicionar
   `expo-tracking-transparency` e o texto de permissão.

## 5. Build novo

RevenueCat e AdMob são módulos nativos: é preciso gerar um build novo (não
basta update OTA):

```sh
npx expo prebuild --clean   # se usar prebuild local
eas build --platform ios --profile development   # para testar
eas build --platform ios --profile production    # para a loja
```

Compras só funcionam em aparelho físico com o sandbox tester (não no
simulador, não no Expo Go).

## 6. Revisão da ficha na App Store

Ao enviar a versão:

- **App Privacy**: anúncios coletam identificadores/dados de uso — atualize o
  questionário (mesmo servindo só anúncios não personalizados, o SDK do
  Google declara coleta de dados de dispositivo).
- **Age Rating**: aproveite para revisar o questionário de UGC — o app tem
  moderação, denúncia e bloqueio, então não deveria estar 18+ (isso hoje
  prejudica a busca).
- **Assinaturas na revisão**: a Apple testa a compra; a tela de paywall já
  tem o botão "Restaurar compras" e o texto de renovação automática exigidos.
  Informe também a URL da política de privacidade e os termos (EULA padrão da
  Apple serve).

## Como o app se comporta sem configurar nada

- Sem `EXPO_PUBLIC_REVENUECAT_*`: a tela premium abre, mas mostra "planos
  indisponíveis"; ninguém vira premium.
- Sem `EXPO_PUBLIC_ADMOB_BANNER_*` em produção: nenhum anúncio aparece.
- No web e no Expo Go os dois SDKs são ignorados sem quebrar o app.
