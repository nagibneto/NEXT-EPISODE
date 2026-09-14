# Notificações de campanha

Duas notificações que não dependem do que o usuário assiste:

| | Quem recebe | Quando | Repete? |
|---|---|---|---|
| **Lembrete de quem sumiu** | Quem não registra nada há 7 dias | Toda sexta, 20h de Brasília | Sim, no máximo a cada 14 dias |
| **Aviso do Instagram** | Todo mundo | Disparo manual, uma vez | Não, nunca |

Ambas respeitam um interruptor próprio em **Perfil → Notificações** (`reengagement` e `announcements`) e registram o que foi entregue em `campaign_deliveries`.

## 1. Banco

Rode o `supabase/schema.sql` atualizado no SQL Editor (ele é idempotente). Isso cria:

- `campaign_deliveries` — o registro de "já recebeu/já viu", por usuário e por campanha;
- `notification_preferences.reengagement` e `.announcements` — os dois interruptores novos (ligados por padrão);
- `public.inactive_users(p_days)` — quem não registrou nada na janela, usado pela Edge Function.

## 2. Edge Functions

```bash
supabase functions deploy notify-inactive --no-verify-jwt
supabase functions deploy notify-announcement --no-verify-jwt
```

As duas exigem o segredo **`CAMPAIGN_PUSH_TOKEN`** no `Authorization` (a checagem é feita dentro da própria função). Sem isso qualquer um que descobrisse a URL poderia disparar push para a base inteira.

Crie o segredo uma vez, com um valor aleatório qualquer:

```bash
supabase secrets set CAMPAIGN_PUSH_TOKEN=<segredo aleatório>
```

Não use a service role key para isso: dentro do runtime das Edge Functions o `SUPABASE_SERVICE_ROLE_KEY` é uma chave do formato novo (`sb_secret_…`), diferente do JWT `service_role` que o painel e o CLI entregam — a comparação nunca bateria.

## 3. Cron do lembrete semanal

Roda **toda sexta às 20h de Brasília** (`0 23 * * 5` em UTC). Atenção: é o mesmo horário da notificação local do quiz (`QUIZ_RESET_HOUR = 20` em `src/lib/quiz.ts`), que sai todo dia para quem tem o app instalado — então na sexta quem está inativo recebe as duas juntas. Para separar, mude o cron para `0 22 * * 5` (19h) ou `0 0 * * 6` (21h).

No painel (**Integrations → Cron**) ou por SQL — o comando está comentado no fim do `supabase/schema.sql`:

```sql
select cron.schedule(
  'notify-inactive-weekly',
  '0 23 * * 5', -- sexta 23:00 UTC = 20h em Brasília (UTC-3)
  $cron$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/notify-inactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SEU_CAMPAIGN_PUSH_TOKEN'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

Antes de agendar, use os modos de teste da seção abaixo. Chamar com `-d '{}'` já envia de verdade para todos os inativos e grava o cooldown de 14 dias de quem receber.

## 4. Campanha do Instagram

**Publique primeiro a versão nova do app.** O push é só metade do aviso: quem tocar nele numa versão antiga abre o app e não vê banner nenhum — o convite com o botão só existe na versão nova. (Não é perda definitiva: o banner olha `seen_at`, não `pushed_at`, então ele ainda aparece quando a pessoa atualizar. Mas o toque no push cai no vazio.)

Com o app já nas lojas (ou via OTA, ver `OTA-UPDATE.md`):

```bash
# Ensaio: conta quantos receberiam, sem enviar nada.
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-announcement' \
  -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
  -H 'Content-Type: application/json' -d '{"dry_run": true}'

# Pra valer.
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-announcement' \
  -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
  -H 'Content-Type: application/json' -d '{}'
```

Repetir o comando é seguro: quem já recebeu tem linha em `campaign_deliveries` e é pulado.

### O banner

Aparece ao abrir o app para quem ainda não viu, com os botões **Seguir no Instagram** e **Agora não**. Os dois encerram o aviso para sempre — o registro é por conta, não por aparelho.

Seguir a conta automaticamente não é possível: o Instagram não tem API pública de follow. O botão abre o perfil (`https://www.instagram.com/app.nextepisode/`, que abre o app do Instagram quando instalado) e o toque em **Seguir** é da pessoa.

### Anunciar outra coisa no futuro

São três lugares, sempre com uma **chave nova** (reaproveitar a antiga faria a campanha ser pulada por todo mundo que já recebeu a anterior):

1. `supabase/functions/notify-announcement` → nova entrada em `CAMPAIGNS` (texto do push, nos dois idiomas);
2. `src/lib/announcements.ts` → `CURRENT_ANNOUNCEMENT` com a mesma chave e a ação do botão;
3. `src/locales/*/announcement.json` → título, subtítulo e rótulos dos botões.

Depois publique o app e dispare a função com `{"campaign_key": "a-chave-nova"}`.

## Testando sem incomodar ninguém

As duas funções aceitam dois modos de teste.

**`dry_run`** — conta quem receberia e mostra uma amostra do texto, sem enviar nada nem gravar nada:

```bash
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-inactive' \
  -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
  -H 'Content-Type: application/json' -d '{"dry_run": true}'
```

```json
{"dryRun":true,"inactive":87,"recipients":27,"candidates":28,
 "sample":{"title":"Lucky sente sua falta 📺","body":"Não esqueça de marcar..."}}
```

`inactive` = quantos estão sumidos; `recipients` = quantos deles têm o app instalado com push ligado; `candidates` = aparelhos (quem tem dois celulares conta duas vezes).

**`test_user_id`** — envia de verdade, mas só para um usuário, ignorando inatividade, preferência, cooldown e entrega já registrada. **Não grava nada**: a campanha de verdade ainda chega normalmente depois.

```bash
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/notify-announcement' \
  -H 'Authorization: Bearer SEU_CAMPAIGN_PUSH_TOKEN' \
  -H 'Content-Type: application/json' -d '{"test_user_id": "SEU_UUID"}'
```

Para achar seu uuid: `select id, username from public.profiles where username = 'seu_usuario';`

### Testando o banner

O banner aparece sozinho ao abrir o app para qualquer conta sem `seen_at` na campanha. Para vê-lo de novo depois de já ter fechado:

```sql
delete from public.campaign_deliveries
where campaign_key = 'instagram-2026-09'
  and user_id = 'SEU_UUID';
```

Na próxima abertura do app ele volta. Diferente do push, o banner não precisa de build nativo — funciona no `npx expo start` normal.

## Conferindo o resultado

```sql
-- Quantos receberam cada campanha, e quantos viram o banner.
select campaign_key,
       count(*) filter (where pushed_at is not null) as push_enviado,
       count(*) filter (where seen_at is not null)   as banner_visto,
       max(greatest(pushed_at, seen_at))             as ultima_entrega
from public.campaign_deliveries
group by campaign_key
order by ultima_entrega desc;
```

Para ver quem está inativo antes de disparar qualquer coisa, use `supabase/queries/atividade-7-dias.sql` (mostra o lado oposto: quem andou ativo).
