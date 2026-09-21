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

-- Avatar escolhido pelo usuário (índice em assets/images/avatars; null = sem avatar).
alter table public.profiles
  add column if not exists avatar_id integer check (avatar_id between 1 and 12);

-- Idioma do app (sincronizado pelo cliente); usado pelas Edge Functions de
-- push para notificar no idioma certo.
alter table public.profiles
  add column if not exists language text not null default 'pt-BR'
    check (language in ('pt-BR', 'en-US'));

-- true para quem entrou por login social (Google/Apple/Facebook): esses
-- provedores não mandam um @usuário, só nome e foto, então o trigger abaixo
-- gera um username temporário e marca a flag. O app força a escolha de um
-- @usuário definitivo (ver src/app/choose-username.tsx) antes de liberar as
-- abas enquanto a flag estiver true.
alter table public.profiles
  add column if not exists needs_username boolean not null default false;

alter table public.profiles enable row level security;

drop policy if exists "Perfis são visíveis para todos os usuários autenticados" on public.profiles;
create policy "Perfis são visíveis para todos os usuários autenticados"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Usuário pode atualizar o próprio perfil" on public.profiles;
create policy "Usuário pode atualizar o próprio perfil"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- Cria o perfil automaticamente no cadastro. No cadastro por e-mail o
-- username vem no signUp (ver src/hooks/use-auth.tsx); no login social não
-- vem nenhum, então geramos um temporário e marcamos needs_username para o
-- app pedir um definitivo antes de liberar as abas.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, needs_username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      'user_' || substr(new.id::text, 1, 8)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name', -- Google/Facebook
      new.raw_user_meta_data ->> 'name',      -- Apple (quando vier)
      new.raw_user_meta_data ->> 'username'
    ),
    new.raw_user_meta_data ->> 'username' is null
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

-- Nome em inglês, gravado ao lado do nome em pt-BR (coluna "name" acima)
-- para exibir localizado sem reconsultar a TMDB. Nulo = registro antigo,
-- ainda não migrado (ver scripts/backfill-i18n-titles.js).
alter table public.followed_shows
  add column if not exists name_en text;

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

-- ---------- Filmes assistidos ----------
create table if not exists public.watched_movies (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  watched_at timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

-- Título em inglês, gravado ao lado do título em pt-BR (coluna "title"
-- acima) para exibir localizado sem reconsultar a TMDB. Nulo = registro
-- antigo, ainda não migrado (ver scripts/backfill-i18n-titles.js).
alter table public.watched_movies
  add column if not exists title_en text;

alter table public.watched_movies enable row level security;

drop policy if exists "Usuário gerencia os próprios filmes assistidos" on public.watched_movies;
create policy "Usuário gerencia os próprios filmes assistidos"
  on public.watched_movies for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Amigos (pedido aceito) podem ver os filmes assistidos (feed social).
drop policy if exists "Amigos veem filmes assistidos" on public.watched_movies;
create policy "Amigos veem filmes assistidos"
  on public.watched_movies for select to authenticated
  using (
    exists (
      select 1 from public.user_follows
      where follower_id = auth.uid() and followed_id = user_id and status = 'accepted'
    )
  );

create index if not exists watched_movies_user_date_idx
  on public.watched_movies (user_id, watched_at desc);

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

-- Notas também servem para filmes: media_type = 'movie' com season/episode = 0.
-- (tmdb_show_id passa a guardar o id do filme nesse caso.)
alter table public.episode_ratings
  add column if not exists media_type text not null default 'tv';
alter table public.episode_ratings
  drop constraint if exists episode_ratings_media_type_check;
alter table public.episode_ratings
  add constraint episode_ratings_media_type_check check (media_type in ('tv', 'movie'));

-- Inclui media_type na chave primária (ids de série e filme são espaços
-- distintos no TMDB e poderiam colidir).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.episode_ratings'::regclass
      and c.contype = 'p'
      and a.attname = 'media_type'
  ) then
    alter table public.episode_ratings drop constraint episode_ratings_pkey;
    alter table public.episode_ratings
      add primary key (user_id, media_type, tmdb_show_id, season_number, episode_number);
  end if;
end $$;

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

-- Respostas: comentário pode apontar para um comentário pai (1 nível só).
alter table public.episode_comments
  add column if not exists parent_id uuid references public.episode_comments (id) on delete cascade;

create index if not exists episode_comments_parent_idx
  on public.episode_comments (parent_id);

-- Limite de frequência contra spam (janelas deslizantes, no app todo):
--   comentários novos: no máximo 2 a cada 5 minutos;
--   respostas: no máximo 10 a cada 5 minutos (mais folgado pra não travar discussão);
--   e não deixa repetir o mesmo texto em menos de 5 minutos.
-- Fica num trigger em vez de na política de RLS porque o Postgres proíbe
-- política que consulta a própria tabela ("infinite recursion detected").
create or replace function public.enforce_comment_limits()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.parent_id is null then
    if (
      select count(*) from public.episode_comments
      where user_id = new.user_id
        and parent_id is null
        and created_at > now() - interval '5 minutes'
    ) >= 2 then
      raise exception 'Você está comentando rápido demais. Aguarde alguns minutos e tente de novo.';
    end if;
  else
    if (
      select count(*) from public.episode_comments
      where user_id = new.user_id
        and parent_id is not null
        and created_at > now() - interval '5 minutes'
    ) >= 10 then
      raise exception 'Você está respondendo rápido demais. Aguarde alguns minutos e tente de novo.';
    end if;
  end if;

  if char_length(new.content) > 0 and exists (
    select 1 from public.episode_comments
    where user_id = new.user_id
      and content = new.content
      and created_at > now() - interval '5 minutes'
  ) then
    raise exception 'Você já enviou esse mesmo comentário há pouco.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_comment_limits on public.episode_comments;
create trigger enforce_comment_limits
  before insert on public.episode_comments
  for each row execute function public.enforce_comment_limits();

drop policy if exists "Usuário remove os próprios comentários" on public.episode_comments;
create policy "Usuário remove os próprios comentários"
  on public.episode_comments for delete to authenticated using (auth.uid() = user_id);

create index if not exists episode_comments_episode_idx
  on public.episode_comments (tmdb_show_id, season_number, episode_number, created_at desc);

-- ---------- Spoiler em comentários ----------
-- Funciona como uma denúncia: usuários sinalizam comentários DOS OUTROS como
-- spoiler, e com 3+ sinalizações o comentário é ocultado para todo mundo
-- (mesmo comportamento da denúncia comum).
-- A coluna is_spoiler é legado de quando o autor podia se automarcar; fica
-- pela compatibilidade com bancos antigos, mas o app não a usa mais.
alter table public.episode_comments add column if not exists is_spoiler boolean not null default false;
alter table public.episode_comments add column if not exists hidden boolean not null default false;

create table if not exists public.comment_spoiler_flags (
  comment_id uuid not null references public.episode_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_spoiler_flags enable row level security;

drop policy if exists "Usuário sinaliza comentário como spoiler" on public.comment_spoiler_flags;
create policy "Usuário sinaliza comentário como spoiler"
  on public.comment_spoiler_flags for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Usuário vê as próprias sinalizações de spoiler" on public.comment_spoiler_flags;
create policy "Usuário vê as próprias sinalizações de spoiler"
  on public.comment_spoiler_flags for select to authenticated using (auth.uid() = user_id);

-- Com 3+ sinalizações de spoiler o comentário é ocultado até revisão manual.
create or replace function public.hide_comment_after_spoiler_flags()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.comment_spoiler_flags where comment_id = new.comment_id) >= 3 then
    update public.episode_comments set hidden = true where id = new.comment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_comment_spoiler_flag on public.comment_spoiler_flags;
create trigger on_comment_spoiler_flag
  after insert on public.comment_spoiler_flags
  for each row execute function public.hide_comment_after_spoiler_flags();

-- Remove a função antiga (marcava is_spoiler em vez de ocultar).
drop function if exists public.mark_comment_spoiler_after_flags();

-- Comentários também servem para filmes: media_type = 'movie' com
-- season/episode = 0 e tmdb_show_id guardando o id do filme.
alter table public.episode_comments
  add column if not exists media_type text not null default 'tv';
alter table public.episode_comments
  drop constraint if exists episode_comments_media_type_check;
alter table public.episode_comments
  add constraint episode_comments_media_type_check check (media_type in ('tv', 'movie'));

-- Imagem/GIF opcional anexada ao comentário (URL pública no bucket comment-media).
alter table public.episode_comments
  add column if not exists image_url text;

-- Permite comentário só com imagem (sem texto).
alter table public.episode_comments
  drop constraint if exists episode_comments_content_check;
alter table public.episode_comments
  add constraint episode_comments_content_check
  check (char_length(content) <= 2000 and (char_length(content) > 0 or image_url is not null));

-- Proíbe links nos comentários (http(s)://, www. e domínio.tld dos TLDs mais
-- comuns). A lista de TLDs evita falso positivo em coisas como "Dr.House".
alter table public.episode_comments
  drop constraint if exists episode_comments_no_urls_check;
alter table public.episode_comments
  add constraint episode_comments_no_urls_check
  check (
    content !~* '(https?://|www\.|\.(com|net|org|io|co|me|tv|app|dev|link|gg|xyz|info|biz|shop|store|online|site|club|top|win|bet|casino|vip|click|live|pro|br|uk|us|ru|cn|in|de|fr|es|it|nl|pl|id|ph|vn|th)([^a-z]|$))'
  );

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

-- Sem política de select de propósito. O bucket é público, então o endpoint
-- /object/public/... serve as imagens sem passar por RLS (é o que o app usa,
-- via getPublicUrl em src/lib/storage.ts). A política que existia aqui não
-- era necessária para exibir nada: ela só liberava LISTAR o bucket, o que
-- deixava qualquer um enumerar todas as imagens de comentários — inclusive as
-- de comentários já ocultados por denúncia. O próprio Security Advisor
-- aponta isso ("Public buckets don't need this").
drop policy if exists "Mídia de comentários é pública" on storage.objects;

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

-- ---------- Notificação push: amizade ----------
-- Dispara a Edge Function supabase/functions/notify-friend-request nos dois
-- momentos que interessam ao outro lado: quando o pedido é criado e quando
-- ele é aceito. Tudo na hora, diferente do resumo diário de episódios novos
-- (cron, ver final do arquivo).
--
-- A URL e a chave vêm do Vault (o SQL Editor não é superusuário, então
-- "alter database ... set" dá permission denied). Se os segredos não
-- existirem, a amizade é gravada normalmente e só não sai push.
--
-- Nome antigo, de quando só existia a notificação de pedido.
drop trigger if exists on_friend_request_created on public.user_follows;
drop function if exists public.notify_friend_request();

create or replace function public.notify_friend_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  function_url text;
  service_key text;
  event_type text;
begin
  if tg_op = 'INSERT' then
    -- A linha recíproca criada no aceite já nasce 'accepted' e não é pedido.
    if new.status <> 'pending' then
      return new;
    end if;
    event_type := 'request';
  else
    -- Só interessa a transição pending -> accepted; outros updates não avisam.
    if old.status is not distinct from new.status or new.status <> 'accepted' then
      return new;
    end if;
    event_type := 'accepted';
  end if;

  begin
    select decrypted_secret into function_url
      from vault.decrypted_secrets where name = 'notify_friend_request_url';
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'notify_friend_request_key';

    if function_url is not null and service_key is not null then
      perform net.http_post(
        url := function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        -- Quem recebe o push sai do tipo do evento: no pedido é o followed_id,
        -- no aceite é o follower_id (quem pediu). A function resolve isso.
        body := jsonb_build_object(
          'follower_id', new.follower_id,
          'followed_id', new.followed_id,
          'type', event_type
        )
      );
    end if;
  exception when others then
    -- A notificação é acessório: se o Vault ou o pg_net falharem, a amizade
    -- tem que ser gravada do mesmo jeito.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists on_friend_request_created on public.user_follows;
create trigger on_friend_request_created
  after insert on public.user_follows
  for each row execute function public.notify_friend_event();

drop trigger if exists on_friend_request_accepted on public.user_follows;
create trigger on_friend_request_accepted
  after update on public.user_follows
  for each row execute function public.notify_friend_event();

-- Configuração única, já feita neste projeto (rode no SQL Editor com os
-- valores do seu — não entra no git porque tem a service role key). Vale
-- para os dois eventos: os segredos mantêm o nome "..._request" por
-- compatibilidade com o que já está gravado no Vault.
--
--   select vault.create_secret(
--     'https://SEU-PROJETO.supabase.co/functions/v1/notify-friend-request',
--     'notify_friend_request_url'
--   );
--   select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'notify_friend_request_key');
--
-- Requer a extensão pg_net habilitada (mesma usada no cron de episódios) e
-- o deploy da function (supabase functions deploy notify-friend-request --no-verify-jwt).

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

-- ---------- Telefone para achar amigos pelos contatos ----------
-- Fica fora de "profiles" de propósito: a policy de select de profiles é
-- "using (true)" para qualquer autenticado, o que vazaria o telefone de
-- todo mundo. Aqui cada um só enxerga a própria linha.
--
-- phone_hash é sha256(E.164) + pepper do servidor (PHONE_HASH_PEPPER, um
-- segredo da Edge Function, nunca exposto ao cliente) — ver
-- supabase/functions/set-phone-number e supabase/functions/match-contacts.
-- De propósito NÃO existe policy de insert/update: a única forma de gravar
-- telefone é pela Edge Function set-phone-number (usa o service role e
-- calcula o pepper no servidor), então o cliente nunca grava um hash sem
-- pepper nem forja o telefone de outra pessoa.
create table if not exists public.phone_contacts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone_number text not null,
  phone_hash text not null unique,
  updated_at timestamptz not null default now()
);

-- Alguém pode ter salvo o telefone de um jeito diferente do que a pessoa
-- cadastrou (sem "+55", ou até sem o DDD) — ver phoneMatchVariants em
-- src/lib/phone.ts. Essas duas colunas guardam hash de variantes menos
-- específicas do mesmo número, só pra aumentar a chance de achar o match;
-- de propósito SEM "unique" (números "sem DDD" podem colidir entre pessoas
-- de cidades diferentes, isso é esperado).
alter table public.phone_contacts add column if not exists phone_hash_national text;
alter table public.phone_contacts add column if not exists phone_hash_local text;

alter table public.phone_contacts enable row level security;

drop policy if exists "Usuário vê o próprio telefone" on public.phone_contacts;
create policy "Usuário vê o próprio telefone"
  on public.phone_contacts for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Usuário remove o próprio telefone" on public.phone_contacts;
create policy "Usuário remove o próprio telefone"
  on public.phone_contacts for delete to authenticated using (auth.uid() = user_id);

create index if not exists phone_contacts_hash_idx on public.phone_contacts (phone_hash);
create index if not exists phone_contacts_hash_national_idx on public.phone_contacts (phone_hash_national);
create index if not exists phone_contacts_hash_local_idx on public.phone_contacts (phone_hash_local);

-- RPC em vez de ".or(phone_hash.in.(...))" direto pela REST: com milhares de
-- hashes peperados (64 hex chars cada, comparados contra 3 colunas), esse
-- filtro monta uma URL de dezenas de milhares de caracteres e o fetch da
-- Edge Function (supabase/functions/match-contacts) estoura com
-- "TypeError: Invalid URL". Recebendo os hashes como parâmetro de função
-- (vai no body do POST, não na querystring), o tamanho da requisição não
-- depende mais da quantidade de contatos do usuário.
create or replace function public.match_phone_contact_hashes(hashes text[], excluding_user_id uuid)
returns table (id uuid, username text, display_name text, avatar_id integer)
language sql
security invoker
set search_path = public
as $$
  select distinct p.id, p.username, p.display_name, p.avatar_id
  from public.phone_contacts pc
  join public.profiles p on p.id = pc.user_id
  where pc.user_id <> excluding_user_id
    and (
      pc.phone_hash = any(hashes)
      or pc.phone_hash_national = any(hashes)
      or pc.phone_hash_local = any(hashes)
    );
$$;

-- ---------- Estatísticas ----------
-- Conta episódios assistidos por série sem esbarrar no limite de linhas da API.
-- last_watched_at alimenta a ordenação da watchlist (série marcada mais
-- recentemente sobe para o topo, ver src/app/(tabs)/index.tsx).
-- O tipo de retorno mudou (ganhou last_watched_at): "create or replace" não
-- troca o shape de OUT parameters, por isso o drop antes.
drop function if exists public.get_watched_counts();
create or replace function public.get_watched_counts()
returns table (tmdb_show_id integer, episode_count bigint, last_watched_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  select tmdb_show_id, count(*) as episode_count, max(watched_at) as last_watched_at
  from public.watched_episodes
  where user_id = auth.uid()
  group by tmdb_show_id
  order by episode_count desc;
$$;

-- ---------- Ranking de tempo assistido (amigos) ----------
-- Conta episódios assistidos por (usuário, série) dentro de uma janela de
-- tempo opcional. security invoker: a RLS de watched_episodes continua
-- valendo, então cada chamada só enxerga o próprio usuário e seus amigos
-- aceitos — não dá pra "espiar" quem não é amigo passando o id na mão.
create or replace function public.get_friends_episode_counts(target_user_ids uuid[], since timestamptz default null)
returns table (user_id uuid, tmdb_show_id integer, episode_count bigint)
language sql
security invoker
set search_path = public
as $$
  select user_id, tmdb_show_id, count(*) as episode_count
  from public.watched_episodes
  where user_id = any(target_user_ids)
    and (since is null or watched_at >= since)
  group by user_id, tmdb_show_id;
$$;

-- Mesma ideia para filmes assistidos (sem agregação: watched_movies já não
-- tem repetição por usuário/filme, então cada linha conta 1 filme).
create or replace function public.get_friends_movie_watches(target_user_ids uuid[], since timestamptz default null)
returns table (user_id uuid, tmdb_id integer)
language sql
security invoker
set search_path = public
as $$
  select user_id, tmdb_id
  from public.watched_movies
  where user_id = any(target_user_ids)
    and (since is null or watched_at >= since);
$$;

-- ---------- Curtidas em comentários ----------
create table if not exists public.comment_likes (
  comment_id uuid not null references public.episode_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

drop policy if exists "Curtidas são visíveis para autenticados" on public.comment_likes;
create policy "Curtidas são visíveis para autenticados"
  on public.comment_likes for select to authenticated using (true);

drop policy if exists "Usuário curte comentários" on public.comment_likes;
create policy "Usuário curte comentários"
  on public.comment_likes for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Usuário remove a própria curtida" on public.comment_likes;
create policy "Usuário remove a própria curtida"
  on public.comment_likes for delete to authenticated using (auth.uid() = user_id);

create index if not exists comment_likes_comment_idx on public.comment_likes (comment_id);

-- ---------- Bloqueio de usuários ----------
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- Só o próprio usuário vê quem ele bloqueou (a lista de bloqueios é privada).
drop policy if exists "Usuário vê os próprios bloqueios" on public.user_blocks;
create policy "Usuário vê os próprios bloqueios"
  on public.user_blocks for select to authenticated using (auth.uid() = blocker_id);

drop policy if exists "Usuário bloqueia outros usuários" on public.user_blocks;
create policy "Usuário bloqueia outros usuários"
  on public.user_blocks for insert to authenticated with check (auth.uid() = blocker_id);

drop policy if exists "Usuário desbloqueia" on public.user_blocks;
create policy "Usuário desbloqueia"
  on public.user_blocks for delete to authenticated using (auth.uid() = blocker_id);

-- Impede pedido de amizade entre quem bloqueou/foi bloqueado.
drop policy if exists "Usuário envia pedido de amizade" on public.user_follows;
create policy "Usuário envia pedido de amizade"
  on public.user_follows for insert to authenticated
  with check (
    auth.uid() = follower_id
    and not exists (
      select 1 from public.user_blocks
      where (blocker_id = follower_id and blocked_id = followed_id)
         or (blocker_id = followed_id and blocked_id = follower_id)
    )
  );

-- ---------- Denúncia de comentários ----------
create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.episode_comments (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);

alter table public.comment_reports enable row level security;

drop policy if exists "Usuário denuncia comentários" on public.comment_reports;
create policy "Usuário denuncia comentários"
  on public.comment_reports for insert to authenticated with check (auth.uid() = reporter_id);

-- Cada um só vê as denúncias que fez (não é um painel de moderação pública).
drop policy if exists "Usuário vê as próprias denúncias" on public.comment_reports;
create policy "Usuário vê as próprias denúncias"
  on public.comment_reports for select to authenticated using (auth.uid() = reporter_id);

-- Oculta automaticamente um comentário com 3+ denúncias, até revisão manual
-- (via SQL Editor / Table Editor no painel do Supabase).
alter table public.episode_comments add column if not exists hidden boolean not null default false;

create or replace function public.hide_comment_after_reports()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.comment_reports where comment_id = new.comment_id) >= 3 then
    update public.episode_comments set hidden = true where id = new.comment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_comment_report_hide on public.comment_reports;
create trigger on_comment_report_hide
  after insert on public.comment_reports
  for each row execute function public.hide_comment_after_reports();

-- Comentários ocultos ou de gente bloqueada somem da visão de quem não é o autor.
drop policy if exists "Comentários são visíveis para todos os usuários autenticados" on public.episode_comments;
create policy "Comentários são visíveis para todos os usuários autenticados"
  on public.episode_comments for select to authenticated
  using (
    (
      hidden = false
      and not exists (
        select 1 from public.user_blocks
        where blocker_id = auth.uid() and blocked_id = episode_comments.user_id
      )
    )
    or user_id = auth.uid()
  );

-- ---------- Favoritos ----------
-- Séries e filmes marcados com a estrelinha na tela do título.
create table if not exists public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  media_type text not null check (media_type in ('tv', 'movie')),
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  favorited_at timestamptz not null default now(),
  -- media_type na chave: ids de série e filme são espaços distintos no TMDB.
  primary key (user_id, media_type, tmdb_id)
);

-- Título em inglês, gravado ao lado do título em pt-BR (coluna "title"
-- acima) para exibir localizado sem reconsultar a TMDB. Nulo = registro
-- antigo, ainda não migrado (ver scripts/backfill-i18n-titles.js).
alter table public.favorites
  add column if not exists title_en text;

alter table public.favorites enable row level security;

drop policy if exists "Usuário gerencia os próprios favoritos" on public.favorites;
create policy "Usuário gerencia os próprios favoritos"
  on public.favorites for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Filmes para assistir ----------
-- Watchlist de filmes ("Para assistir"). Séries não precisam de tabela:
-- entram no "Para assistir" quando são seguidas sem nenhum episódio visto.
create table if not exists public.watchlist_movies (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  added_at timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

-- Título em inglês, gravado ao lado do título em pt-BR (coluna "title"
-- acima) para exibir localizado sem reconsultar a TMDB. Nulo = registro
-- antigo, ainda não migrado (ver scripts/backfill-i18n-titles.js).
alter table public.watchlist_movies
  add column if not exists title_en text;

alter table public.watchlist_movies enable row level security;

drop policy if exists "Usuário gerencia os próprios filmes para assistir" on public.watchlist_movies;
create policy "Usuário gerencia os próprios filmes para assistir"
  on public.watchlist_movies for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Curtidas no feed (assistidos) ----------
-- Curtida numa atividade "amigo assistiu série/filme" do feed. A atividade não
-- tem id próprio (é agrupada no client por dono + série/filme + dia, ver
-- getFriendsFeed em src/lib/db.ts), então a curtida usa a mesma chave.
create table if not exists public.feed_likes (
  liker_id uuid not null references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  media_type text not null check (media_type in ('tv', 'movie')),
  tmdb_id integer not null,
  activity_date date not null,
  created_at timestamptz not null default now(),
  primary key (liker_id, owner_id, media_type, tmdb_id, activity_date),
  check (liker_id <> owner_id)
);

alter table public.feed_likes enable row level security;

drop policy if exists "Curtidas do feed são visíveis para autenticados" on public.feed_likes;
create policy "Curtidas do feed são visíveis para autenticados"
  on public.feed_likes for select to authenticated using (true);

drop policy if exists "Usuário curte atividades do feed" on public.feed_likes;
create policy "Usuário curte atividades do feed"
  on public.feed_likes for insert to authenticated with check (auth.uid() = liker_id);

drop policy if exists "Usuário remove a própria curtida do feed" on public.feed_likes;
create policy "Usuário remove a própria curtida do feed"
  on public.feed_likes for delete to authenticated using (auth.uid() = liker_id);

create index if not exists feed_likes_owner_idx
  on public.feed_likes (owner_id, media_type, tmdb_id, activity_date);

create index if not exists feed_likes_liker_idx on public.feed_likes (liker_id, created_at desc);

-- ---------- Notificação push: curtida no feed ----------
-- Dispara a Edge Function supabase/functions/notify-feed-like sempre que
-- alguém curte uma atividade "assistiu" de outra pessoa (mesmo padrão do
-- trigger de amizade, ver "Notificação push: amizade" acima).
create or replace function public.notify_feed_like()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  function_url text;
  service_key text;
begin
  begin
    select decrypted_secret into function_url
      from vault.decrypted_secrets where name = 'notify_feed_like_url';
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'notify_feed_like_key';

    if function_url is not null and service_key is not null then
      perform net.http_post(
        url := function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object(
          'liker_id', new.liker_id,
          'owner_id', new.owner_id,
          'media_type', new.media_type,
          'tmdb_id', new.tmdb_id
        )
      );
    end if;
  exception when others then
    -- A notificação é acessório: se o Vault ou o pg_net falharem, a curtida
    -- tem que ser gravada do mesmo jeito.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists on_feed_like_created on public.feed_likes;
create trigger on_feed_like_created
  after insert on public.feed_likes
  for each row execute function public.notify_feed_like();

-- Configuração única (rode no SQL Editor com os valores do seu projeto —
-- não entra no git porque tem a service role key):
--
--   select vault.create_secret(
--     'https://SEU-PROJETO.supabase.co/functions/v1/notify-feed-like',
--     'notify_feed_like_url'
--   );
--   select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'notify_feed_like_key');
--
-- Requer a extensão pg_net habilitada e o deploy da function
-- (supabase functions deploy notify-feed-like --no-verify-jwt).

-- ---------- Preferências de notificação ----------
-- Cada linha vale para os pushes remotos (Expo Push via Edge Functions);
-- ausência de linha = tudo ativado (comportamento padrão de sempre).
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  new_episodes boolean not null default true,
  friend_requests boolean not null default true,
  friend_accepted boolean not null default true,
  feed_likes boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Diferente das demais colunas (todas de push remoto), esta controla a
-- notificação local diária do quiz (ver scheduleDailyQuizNotification).
alter table public.notification_preferences
  add column if not exists daily_quiz boolean not null default true;

alter table public.notification_preferences enable row level security;

drop policy if exists "Usuário gerencia as próprias preferências de notificação" on public.notification_preferences;
create policy "Usuário gerencia as próprias preferências de notificação"
  on public.notification_preferences for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Quiz diário ----------
-- Uma pergunta por dia sobre cinema e séries. O usuário responde uma vez ao
-- dia (chave primária user_id + quiz_date, no fuso do aparelho; o "dia" do
-- quiz vira às 20h locais, ver QUIZ_RESET_HOUR em src/lib/quiz.ts) e o streak
-- de acertos consecutivos é calculado no cliente a partir do histórico (ver
-- src/lib/quiz.ts). Sem policy de update/delete de propósito: a resposta do
-- dia é definitiva, ninguém reescreve o próprio histórico para forjar streak.
create table if not exists public.quiz_answers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_date date not null,
  question_id text not null,
  selected_index integer not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, quiz_date)
);

alter table public.quiz_answers enable row level security;

drop policy if exists "Usuário vê as próprias respostas do quiz" on public.quiz_answers;
create policy "Usuário vê as próprias respostas do quiz"
  on public.quiz_answers for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Usuário cria as próprias respostas do quiz" on public.quiz_answers;
create policy "Usuário cria as próprias respostas do quiz"
  on public.quiz_answers for insert to authenticated with check (auth.uid() = user_id);

-- Amigos (pedido aceito) veem as respostas uns dos outros — alimenta o placar
-- de escaladas na tela do quiz (mesmo padrão de watched_episodes/watched_movies).
drop policy if exists "Amigos veem respostas do quiz" on public.quiz_answers;
create policy "Amigos veem respostas do quiz"
  on public.quiz_answers for select to authenticated
  using (
    exists (
      select 1 from public.user_follows
      where follower_id = auth.uid() and followed_id = user_id and status = 'accepted'
    )
  );

create index if not exists quiz_answers_user_date_idx
  on public.quiz_answers (user_id, quiz_date desc);

-- ---------- Campanhas de notificação (reengajamento e avisos) ----------
-- Registro do que já foi enviado/exibido para cada usuário em cada campanha.
-- Serve para dois casos:
--   * aviso único ("siga a gente no Instagram"): existe a linha = não mostra
--     nunca mais. Para rodar de novo mais tarde, é só usar uma campaign_key
--     nova (ver ANNOUNCEMENT em src/lib/announcements.ts e CAMPAIGNS em
--     supabase/functions/notify-announcement).
--   * lembrete recorrente (quem sumiu há 7 dias): a linha é reaproveitada e
--     pushed_at vira o controle de "não insistir antes de N dias".
--
-- pushed_at = quando o push saiu (gravado pela Edge Function, service role).
-- seen_at   = quando o banner apareceu dentro do app (gravado pelo cliente).
create table if not exists public.campaign_deliveries (
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_key text not null check (char_length(campaign_key) between 1 and 80),
  pushed_at timestamptz,
  seen_at timestamptz,
  primary key (user_id, campaign_key)
);

alter table public.campaign_deliveries enable row level security;

-- O cliente só enxerga e marca as próprias entregas. Ele consegue gravar
-- pushed_at também, mas o efeito seria só deixar de receber o próprio push —
-- nada que já não dê para fazer desligando a preferência.
drop policy if exists "Usuário gerencia as próprias entregas de campanha" on public.campaign_deliveries;
create policy "Usuário gerencia as próprias entregas de campanha"
  on public.campaign_deliveries for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists campaign_deliveries_key_idx
  on public.campaign_deliveries (campaign_key, pushed_at);

-- Preferências das duas campanhas (mesmo padrão das demais: ausência de
-- linha = tudo ligado).
alter table public.notification_preferences
  add column if not exists reengagement boolean not null default true;
alter table public.notification_preferences
  add column if not exists announcements boolean not null default true;

-- Usuários que não registraram nada no app nos últimos p_days dias.
-- É a mesma união de tabelas da consulta de atividade
-- (supabase/queries/atividade-7-dias.sql), mas invertida: aqui interessa quem
-- NÃO aparece. Quem criou a conta dentro da janela fica de fora — não faz
-- sentido cobrar quem acabou de instalar.
--
-- Atenção: as tabelas guardam só o estado atual, sem histórico. Quem marcou e
-- desmarcou um episódio conta como inativo; quem remarcou um episódio antigo
-- conta como ativo (o upsert atualiza watched_at).
create or replace function public.inactive_users(p_days integer default 7)
returns table (user_id uuid, language text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.language
  from public.profiles p
  where p.created_at < now() - make_interval(days => p_days)
    and not exists (
      select 1
      from (
        select we.user_id,     we.watched_at   as em from public.watched_episodes we
        union all
        select wm.user_id,     wm.watched_at         from public.watched_movies wm
        union all
        select fs.user_id,     fs.followed_at        from public.followed_shows fs
        union all
        select wl.user_id,     wl.added_at           from public.watchlist_movies wl
        union all
        select fv.user_id,     fv.favorited_at       from public.favorites fv
        union all
        select er.user_id,     er.rated_at           from public.episode_ratings er
        union all
        select ec.user_id,     ec.created_at         from public.episode_comments ec
        union all
        select cl.user_id,     cl.created_at         from public.comment_likes cl
        union all
        select fl.liker_id,    fl.created_at         from public.feed_likes fl
        union all
        select qa.user_id,     qa.answered_at        from public.quiz_answers qa
        union all
        select uf.follower_id, uf.created_at         from public.user_follows uf
      ) a
      where a.user_id = p.id
        and a.em >= now() - make_interval(days => p_days)
    );
$$;

-- Security definer para enxergar a atividade de todo mundo por baixo do RLS.
-- Só a Edge Function (service role) chama; ninguém mais precisa dela, e
-- liberada para authenticated viraria um jeito de saber quem anda sumido.
revoke all on function public.inactive_users(integer) from public, anon, authenticated;

-- ---------- Permissões das funções de trigger ----------
-- Precisa ficar no fim do arquivo: "create or replace function" concede
-- EXECUTE a PUBLIC de novo a cada execução, então revogar antes não adianta.
--
-- O Security Advisor do Supabase acusa toda função SECURITY DEFINER que anon
-- ou authenticated podem executar. No nosso caso são só funções de trigger, e
-- o Postgres recusa chamá-las direto ("trigger functions can only be called
-- as triggers") — não dá para explorar. Ainda assim revogamos: não custa
-- nada, e uma lista de alertas cheia de falso positivo esconde o dia em que
-- aparecer um alerta de verdade.
--
-- Revogar EXECUTE não afeta os triggers: eles rodam com o privilégio do dono
-- da tabela, não com o de quem fez o insert/update.
--
-- O laço pega todas as funções de trigger do schema public, inclusive as que
-- ainda não estão versionadas aqui, e cobre automaticamente as futuras.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end $$;

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

-- A Edge Function supabase/functions/notify-inactive roda 1x por semana e
-- cutuca quem não registra nada há 7 dias (respeita a preferência
-- "reengagement" e não repete antes de 14 dias, ver a própria função):
--
--   select cron.schedule(
--     'notify-inactive-weekly',
--     '0 23 * * 5', -- sexta 23:00 UTC = 20h em Brasília (UTC-3)
--     $cron$
--     select net.http_post(
--       url := 'https://SEU-PROJETO.supabase.co/functions/v1/notify-inactive',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer SEU_CAMPAIGN_PUSH_TOKEN'
--       ),
--       body := '{}'::jsonb
--     );
--     $cron$
--   );
--
-- CAMPAIGN_PUSH_TOKEN é o segredo que autoriza o disparo, criado com
-- "supabase secrets set CAMPAIGN_PUSH_TOKEN=...". Não use a service role key
-- aqui: dentro do runtime das Edge Functions o SUPABASE_SERVICE_ROLE_KEY é uma
-- chave do formato novo (sb_secret_...), diferente do JWT que o painel mostra.
--
-- Já supabase/functions/notify-announcement é o aviso único (Instagram). Não
-- tem cron: é disparada à mão uma vez, ver o cabeçalho da função.

-- ---------------------------------------------------------------------------
-- Versões publicadas (modal "atualize o app")
-- ---------------------------------------------------------------------------
-- O app instalado só conhece o próprio changelog — quem está na 1.0.6 não tem
-- como saber o que mudou na 1.0.7. Por isso a lista de versões mora aqui: o
-- cliente compara a versão instalada (app.json -> expo.version) com o que
-- estiver nesta tabela e monta o "o que há de novo desde a sua versão".
--
-- Fluxo ao lançar: subiu a build pra loja e ela foi aprovada -> insere a linha.
-- Inserir ANTES da aprovação faria o modal mandar todo mundo para uma loja que
-- ainda mostra a versão velha.
create table if not exists public.app_releases (
  -- "1.0.7" — só números e pontos, para a comparação do cliente funcionar.
  version text primary key check (version ~ '^[0-9]+(\.[0-9]+)*$'),
  released_at timestamptz not null default now(),
  -- null = saiu nas duas lojas. 'ios'/'android' quando uma review atrasou e a
  -- versão ficou disponível só de um lado.
  platform text check (platform in ('ios', 'android')),
  -- true = modal sem "agora não" (quebra de compatibilidade). Use com muita
  -- parcimônia: trava o app de quem não puder atualizar na hora.
  mandatory boolean not null default false,
  -- { "pt-BR": ["Quiz do dia", "..."], "en-US": [...] } — uma frase curta por
  -- melhoria, na ordem em que devem aparecer. Idioma sem entrada cai no pt-BR.
  highlights jsonb not null default '{}'::jsonb
);

alter table public.app_releases enable row level security;

-- Leitura para qualquer sessão; escrita só pelo painel (service role ignora
-- RLS). Não há policy de insert/update de propósito.
drop policy if exists "Versões são públicas" on public.app_releases;
create policy "Versões são públicas"
  on public.app_releases for select to authenticated, anon
  using (true);

create index if not exists app_releases_released_at_idx
  on public.app_releases (released_at desc);

-- Exemplo de lançamento (rodar no SQL Editor depois da aprovação na loja):
--
--   insert into public.app_releases (version, highlights) values (
--     '1.0.7',
--     '{
--       "pt-BR": ["Widgets na tela de início", "Busca mais rápida"],
--       "en-US": ["Home screen widgets", "Faster search"]
--     }'::jsonb
--   );
