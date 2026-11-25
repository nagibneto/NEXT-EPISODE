-- Prepara o banco para a aba Games (branch games_deploy).
-- Rodar UMA vez no SQL Editor do Supabase. É o mesmo conteúdo que já está em
-- supabase/schema.sql — este arquivo existe só para não precisar rodar o
-- schema inteiro. Pode rodar de novo sem problema (tudo é idempotente).

-- 1) Notas e comentários passam a aceitar media_type = 'game'
--    (tmdb_show_id guarda o id da IGDB; season/episode = 0).
alter table public.episode_ratings
  drop constraint if exists episode_ratings_media_type_check;
alter table public.episode_ratings
  add constraint episode_ratings_media_type_check check (media_type in ('tv', 'movie', 'game'));

alter table public.episode_comments
  drop constraint if exists episode_comments_media_type_check;
alter table public.episode_comments
  add constraint episode_comments_media_type_check check (media_type in ('tv', 'movie', 'game'));

-- 2) Coleção de games de cada usuário.
create table if not exists public.game_library (
  user_id uuid not null references public.profiles (id) on delete cascade,
  igdb_id integer not null,
  name text not null,
  cover_image_id text,
  status text not null check (status in ('want', 'playing', 'completed', 'dropped')),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, igdb_id)
);

create index if not exists game_library_user_updated_idx
  on public.game_library (user_id, updated_at desc);

alter table public.game_library enable row level security;

drop policy if exists "Usuário gerencia a própria coleção de games" on public.game_library;
create policy "Usuário gerencia a própria coleção de games"
  on public.game_library for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Amigos veem a coleção de games" on public.game_library;
create policy "Amigos veem a coleção de games"
  on public.game_library for select to authenticated
  using (
    exists (
      select 1 from public.user_follows
      where follower_id = auth.uid() and followed_id = user_id and status = 'accepted'
    )
  );
