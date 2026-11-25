-- Tokens de serviços externos usados pelas Edge Functions (hoje: a conta
-- robô da PSN, function psn). Rodar UMA vez no SQL Editor; idempotente.
--
-- RLS ligado e SEM nenhuma policy de propósito: ninguém pelo app consegue
-- ler nem escrever; só a service role (usada dentro da Edge Function).
create table if not exists public.service_tokens (
  service text primary key,
  access_token text,
  access_expires_at timestamptz,
  refresh_token text,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.service_tokens enable row level security;
