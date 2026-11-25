-- Contas de games vinculadas (Steam agora; Xbox/PSN depois). Rodar UMA vez no
-- SQL Editor. Mesmo conteúdo do fim de supabase/schema.sql; idempotente.
--
-- Guarda só o identificador PÚBLICO da conta (o usuário digita o perfil, sem
-- login) e o nome/avatar para exibir. Conquistas e horas são lidas na hora,
-- pela Edge Function steam.
create table if not exists public.linked_game_accounts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('steam', 'xbox', 'psn')),
  account_id text not null,
  display_name text,
  avatar_url text,
  linked_at timestamptz not null default now(),
  primary key (user_id, platform)
);

alter table public.linked_game_accounts enable row level security;

drop policy if exists "Usuário gerencia as próprias contas de games" on public.linked_game_accounts;
create policy "Usuário gerencia as próprias contas de games"
  on public.linked_game_accounts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Amigos veem as contas de games" on public.linked_game_accounts;
create policy "Amigos veem as contas de games"
  on public.linked_game_accounts for select to authenticated
  using (
    exists (
      select 1 from public.user_follows
      where follower_id = auth.uid() and followed_id = user_id and status = 'accepted'
    )
  );
