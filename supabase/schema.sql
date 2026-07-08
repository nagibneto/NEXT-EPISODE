-- Schema do banco para o app TV Time.
-- Execute este arquivo no SQL Editor do painel do Supabase (https://supabase.com/dashboard).
-- É idempotente: pode ser executado de novo sempre que houver novidades.

-- ---------- Perfis ----------
-- Criado automaticamente quando um usuário se cadastra (trigger abaixo).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 30),
  display_name text check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

-- Migração para bancos criados antes do apelido existir.
alter table public.profiles
  add column if not exists display_name text check (char_length(display_name) between 1 and 40);

alter table public.profiles enable row level security;

drop policy if exists "Perfis são visíveis para todos os usuários autenticados" on public.profiles;
create policy "Perfis são visíveis para todos os usuários autenticados"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Usuário pode atualizar o próprio perfil" on public.profiles;
create policy "Usuário pode atualizar o próprio perfil"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- Cria o perfil automaticamente no cadastro, usando o username enviado no signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      'user_' || substr(new.id::text, 1, 8)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'username'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Séries seguidas ----------
create table if not exists public.followed_shows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_id integer not null,
  name text not null,
  poster_path text,
  followed_at timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

alter table public.followed_shows enable row level security;

drop policy if exists "Usuário gerencia as próprias séries seguidas" on public.followed_shows;
create policy "Usuário gerencia as próprias séries seguidas"
  on public.followed_shows for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Episódios assistidos ----------
create table if not exists public.watched_episodes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_show_id integer not null,
  season_number integer not null,
  episode_number integer not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, tmdb_show_id, season_number, episode_number)
);

alter table public.watched_episodes enable row level security;

drop policy if exists "Usuário gerencia os próprios episódios assistidos" on public.watched_episodes;
create policy "Usuário gerencia os próprios episódios assistidos"
  on public.watched_episodes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Notas de episódios ----------
create table if not exists public.episode_ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_show_id integer not null,
  season_number integer not null,
  episode_number integer not null,
  rating integer not null check (rating between 1 and 10),
  rated_at timestamptz not null default now(),
  primary key (user_id, tmdb_show_id, season_number, episode_number)
);

alter table public.episode_ratings enable row level security;

drop policy if exists "Notas são visíveis para todos os usuários autenticados" on public.episode_ratings;
create policy "Notas são visíveis para todos os usuários autenticados"
  on public.episode_ratings for select to authenticated using (true);

drop policy if exists "Usuário gerencia as próprias notas" on public.episode_ratings;
create policy "Usuário gerencia as próprias notas"
  on public.episode_ratings for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Usuário atualiza as próprias notas" on public.episode_ratings;
create policy "Usuário atualiza as próprias notas"
  on public.episode_ratings for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Usuário remove as próprias notas" on public.episode_ratings;
create policy "Usuário remove as próprias notas"
  on public.episode_ratings for delete to authenticated using (auth.uid() = user_id);

create index if not exists episode_ratings_episode_idx
  on public.episode_ratings (tmdb_show_id, season_number, episode_number);

-- ---------- Comentários de episódios ----------
create table if not exists public.episode_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_show_id integer not null,
  season_number integer not null,
  episode_number integer not null,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.episode_comments enable row level security;

drop policy if exists "Comentários são visíveis para todos os usuários autenticados" on public.episode_comments;
create policy "Comentários são visíveis para todos os usuários autenticados"
  on public.episode_comments for select to authenticated using (true);

drop policy if exists "Usuário cria os próprios comentários" on public.episode_comments;
create policy "Usuário cria os próprios comentários"
  on public.episode_comments for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Usuário remove os próprios comentários" on public.episode_comments;
create policy "Usuário remove os próprios comentários"
  on public.episode_comments for delete to authenticated using (auth.uid() = user_id);

create index if not exists episode_comments_episode_idx
  on public.episode_comments (tmdb_show_id, season_number, episode_number, created_at desc);

-- Imagem/GIF opcional anexada ao comentário (URL pública no bucket comment-media).
alter table public.episode_comments
  add column if not exists image_url text;

-- Permite comentário só com imagem (sem texto).
alter table public.episode_comments
  drop constraint if exists episode_comments_content_check;
alter table public.episode_comments
  add constraint episode_comments_content_check
  check (char_length(content) <= 2000 and (char_length(content) > 0 or image_url is not null));

-- ---------- Storage: mídia dos comentários ----------
-- Bucket público (leitura) com upload restrito à pasta do próprio usuário.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-media',
  'comment-media',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Usuário envia mídia na própria pasta" on storage.objects;
create policy "Usuário envia mídia na própria pasta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comment-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Mídia de comentários é pública" on storage.objects;
create policy "Mídia de comentários é pública"
  on storage.objects for select to public
  using (bucket_id = 'comment-media');

drop policy if exists "Usuário remove a própria mídia" on storage.objects;
create policy "Usuário remove a própria mídia"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'comment-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- Amigos (solicitação + aceite) ----------
-- follower_id manda o pedido para followed_id. Enquanto "pending", é só um
-- pedido (o outro lado ainda não vê a pessoa como amiga). Quando o
-- destinatário aceita, criamos a linha recíproca já "accepted" — daí os dois
-- lados enxergam a amizade e o feed social do outro.
create table if not exists public.user_follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followed_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

-- Migração: bancos criados antes do fluxo de pedido/aceite. Relações que já
-- existiam eram "seguir" direto, então viram aceitas para não quebrar quem
-- já usava o app.
alter table public.user_follows add column if not exists status text;
update public.user_follows set status = 'accepted' where status is null;
alter table public.user_follows alter column status set default 'pending';
alter table public.user_follows alter column status set not null;
alter table public.user_follows drop constraint if exists user_follows_status_check;
alter table public.user_follows add constraint user_follows_status_check
  check (status in ('pending', 'accepted'));

alter table public.user_follows enable row level security;

drop policy if exists "Relações de seguir são visíveis para autenticados" on public.user_follows;
create policy "Relações de seguir são visíveis para autenticados"
  on public.user_follows for select to authenticated using (true);

drop policy if exists "Usuário segue outros usuários" on public.user_follows;
drop policy if exists "Usuário envia pedido de amizade" on public.user_follows;
create policy "Usuário envia pedido de amizade"
  on public.user_follows for insert to authenticated with check (auth.uid() = follower_id);

-- Só quem recebeu o pedido pode aceitá-lo (muda pending -> accepted).
drop policy if exists "Destinatário aceita pedido de amizade" on public.user_follows;
create policy "Destinatário aceita pedido de amizade"
  on public.user_follows for update to authenticated
  using (auth.uid() = followed_id)
  with check (auth.uid() = followed_id);

-- Qualquer um dos dois lados pode remover a relação (cancelar pedido, recusar ou desfazer amizade).
drop policy if exists "Usuário deixa de seguir" on public.user_follows;
drop policy if exists "Usuário remove pedido ou amizade" on public.user_follows;
create policy "Usuário remove pedido ou amizade"
  on public.user_follows for delete to authenticated
  using (auth.uid() = follower_id or auth.uid() = followed_id);

create index if not exists user_follows_followed_idx on public.user_follows (followed_id);

-- Amigos (pedido aceito) podem ver o histórico de episódios assistidos (feed social).
drop policy if exists "Amigos veem episódios assistidos" on public.watched_episodes;
create policy "Amigos veem episódios assistidos"
  on public.watched_episodes for select to authenticated
  using (
    exists (
      select 1 from public.user_follows
      where follower_id = auth.uid() and followed_id = user_id and status = 'accepted'
    )
  );

-- Índices para montar o feed por data.
create index if not exists watched_episodes_user_date_idx
  on public.watched_episodes (user_id, watched_at desc);

create index if not exists episode_comments_user_date_idx
  on public.episode_comments (user_id, created_at desc);

-- ---------- Push tokens (notificações remotas) ----------
create table if not exists public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

drop policy if exists "Usuário gerencia os próprios push tokens" on public.push_tokens;
create policy "Usuário gerencia os próprios push tokens"
  on public.push_tokens for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Estatísticas ----------
-- Conta episódios assistidos por série sem esbarrar no limite de linhas da API.
create or replace function public.get_watched_counts()
returns table (tmdb_show_id integer, episode_count bigint)
language sql
security invoker
set search_path = public
as $$
  select tmdb_show_id, count(*) as episode_count
  from public.watched_episodes
  where user_id = auth.uid()
  group by tmdb_show_id
  order by episode_count desc;
$$;

-- ---------- Cron das notificações remotas ----------
-- A Edge Function supabase/functions/notify-new-episodes é executada 1x por dia.
-- Agende no painel (Integrations → Cron) ou com pg_cron + pg_net:
--
--   select cron.schedule(
--     'notify-new-episodes-daily',
--     '0 12 * * *', -- 12:00 UTC = 9h em Brasília
--     $cron$
--     select net.http_post(
--       url := 'https://SEU-PROJETO.supabase.co/functions/v1/notify-new-episodes',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
--       ),
--       body := '{}'::jsonb
--     );
--     $cron$
--   );
--
-- Requer as extensões pg_cron e pg_net habilitadas no projeto.
