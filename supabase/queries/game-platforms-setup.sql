-- Interruptor remoto das integrações de games (Steam, PSN, Xbox).
-- Rodar UMA vez no SQL Editor; idempotente. Mesmo conteúdo do fim de
-- supabase/schema.sql.
--
-- Para DESLIGAR uma plataforma (some do app na hora, sem versão nova):
--   update public.game_platforms set enabled = false, updated_at = now() where platform = 'psn';
-- Para religar: o mesmo com enabled = true.
create table if not exists public.game_platforms (
  platform text primary key check (platform in ('steam', 'psn', 'xbox')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.game_platforms enable row level security;

drop policy if exists "Plataformas de games são visíveis para usuários autenticados" on public.game_platforms;
create policy "Plataformas de games são visíveis para usuários autenticados"
  on public.game_platforms for select to authenticated using (true);

insert into public.game_platforms (platform, enabled)
values ('steam', true), ('psn', true), ('xbox', true)
on conflict (platform) do nothing;
