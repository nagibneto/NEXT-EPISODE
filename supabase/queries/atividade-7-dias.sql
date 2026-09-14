-- Atividade dos usuários nos últimos 7 dias.
-- Para rodar no SQL Editor do Supabase (roda como service role, ignora RLS).
-- Cada tabela guarda o "quando" com um nome diferente, então a CTE normaliza
-- tudo em (user_id, em, tipo) antes de agrupar.

with atividade as (
  select user_id,    watched_at   as em, 'episodio'    as tipo from public.watched_episodes
  union all
  select user_id,    watched_at,         'filme'             from public.watched_movies
  union all
  select user_id,    followed_at,        'serie_seguida'     from public.followed_shows
  union all
  select user_id,    added_at,           'watchlist'         from public.watchlist_movies
  union all
  select user_id,    favorited_at,       'favorito'          from public.favorites
  union all
  select user_id,    rated_at,           'nota'              from public.episode_ratings
  union all
  select user_id,    created_at,         'comentario'        from public.episode_comments
  union all
  select user_id,    created_at,         'curtida_coment'    from public.comment_likes
  union all
  select liker_id,   created_at,         'curtida_feed'      from public.feed_likes
  union all
  select user_id,    answered_at,        'quiz'              from public.quiz_answers
  union all
  select follower_id, created_at,        'pedido_amizade'    from public.user_follows
)
select
  p.username,
  p.display_name,
  count(*)                                                as acoes,
  count(*) filter (where a.tipo = 'episodio')             as episodios,
  count(*) filter (where a.tipo = 'filme')                as filmes,
  count(*) filter (where a.tipo = 'serie_seguida')        as series_seguidas,
  count(*) filter (where a.tipo = 'watchlist')            as watchlist,
  count(*) filter (where a.tipo = 'favorito')             as favoritos,
  count(*) filter (where a.tipo = 'nota')                 as notas,
  count(*) filter (where a.tipo = 'comentario')           as comentarios,
  count(*) filter (where a.tipo in ('curtida_coment', 'curtida_feed')) as curtidas,
  count(*) filter (where a.tipo = 'quiz')                 as quiz,
  count(*) filter (where a.tipo = 'pedido_amizade')       as pedidos_amizade,
  count(distinct a.em::date)                              as dias_ativos,
  max(a.em)                                               as ultima_atividade,
  a.user_id
from atividade a
join public.profiles p on p.id = a.user_id
where a.em >= now() - interval '7 days'
group by a.user_id, p.username, p.display_name
order by acoes desc;


-- ---------------------------------------------------------------------------
-- Variações úteis (rode uma de cada vez)
-- ---------------------------------------------------------------------------

-- 1) Linha do tempo de um usuário específico (trocar o username).
--    Serve pra investigar quem postou algo estranho.
/*
with atividade as (
  select user_id, watched_at as em, 'episodio' as tipo,
         'S' || season_number || 'E' || episode_number || ' (show ' || tmdb_show_id || ')' as detalhe
    from public.watched_episodes
  union all
  select user_id, watched_at, 'filme', title from public.watched_movies
  union all
  select user_id, followed_at, 'serie_seguida', name from public.followed_shows
  union all
  select user_id, added_at, 'watchlist', title from public.watchlist_movies
  union all
  select user_id, favorited_at, 'favorito', title from public.favorites
  union all
  select user_id, rated_at, 'nota', 'nota ' || rating from public.episode_ratings
  union all
  select user_id, created_at, 'comentario', coalesce(nullif(content, ''), image_url)
    from public.episode_comments
  union all
  select user_id, answered_at, 'quiz', case when is_correct then 'acertou' else 'errou' end
    from public.quiz_answers
)
select a.em, a.tipo, a.detalhe
from atividade a
join public.profiles p on p.id = a.user_id
where p.username = 'COLE_O_USERNAME'
  and a.em >= now() - interval '7 days'
order by a.em desc;
*/

-- 2) Quantas ações por dia, no app todo (pra ver se o movimento está subindo).
/*
select a.em::date as dia, count(*) as acoes, count(distinct a.user_id) as usuarios
from ( ... cole aqui a CTE "atividade" do topo ... ) a
where a.em >= now() - interval '7 days'
group by 1 order by 1 desc;
*/

-- 3) Cadastros novos nos últimos 7 dias.
/*
select username, display_name, created_at, id
from public.profiles
where created_at >= now() - interval '7 days'
order by created_at desc;
*/
