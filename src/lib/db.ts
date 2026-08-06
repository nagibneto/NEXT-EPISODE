/**
 * Consultas ao banco (Supabase). Tabelas definidas em supabase/schema.sql.
 */

import { supabase } from './supabase';

/**
 * Extrai uma mensagem legível de qualquer erro. Os erros do Supabase nem
 * sempre são instâncias de Error (podem ser objetos simples com .message),
 * e sem isso a tela mostraria só um fallback genérico escondendo a causa.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/**
 * supabase.functions.invoke() só devolve "Edge Function returned a non-2xx
 * status code" em error.message quando a function responde com erro — a
 * mensagem de verdade (a que a gente escreve com Response.json({ error })
 * nas functions) fica escondida em error.context, que é a Response crua e
 * precisa ser lida à parte. Usado por setPhoneNumber/matchContacts abaixo.
 */
async function edgeFunctionError(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body && typeof body.error === 'string' && body.error) return new Error(body.error);
    } catch {
      // corpo não era JSON — segue com o fallback abaixo.
    }
  }
  return new Error(errorMessage(error, fallback));
}

export interface FollowedShow {
  tmdb_id: number;
  name: string;
  /** Nome em inglês; `null` em registros antigos ainda não migrados. */
  name_en: string | null;
  poster_path: string | null;
  followed_at: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  /** Índice do avatar escolhido (1–12, ver src/lib/avatars.ts); null = sem avatar. */
  avatar_id: number | null;
}

/** Profile do próprio usuário logado, com o campo que guarda choose-username.tsx (ver (tabs)/_layout.tsx). */
export interface OwnProfile extends Profile {
  /** true para quem entrou por login social e ainda não escolheu um @usuário definitivo. */
  needs_username: boolean;
}

/** Séries e filmes compartilham as tabelas de notas/comentários; isto distingue os dois. */
export type MediaType = 'tv' | 'movie';

/** Nome exibido no app: apelido quando definido, senão o username. */
export function profileDisplayName(profile: Pick<Profile, 'username' | 'display_name'> | null) {
  if (!profile) return 'Usuário';
  return profile.display_name?.trim() || profile.username;
}

export interface EpisodeRating {
  user_id: string;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  rating: number;
}

export interface EpisodeComment {
  id: string;
  user_id: string;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  content: string;
  image_url: string | null;
  created_at: string;
  /** id do comentário pai quando isto é uma resposta (1 nível só). */
  parent_id: string | null;
  like_count: number;
  liked_by_me: boolean;
  profiles: { username: string; display_name: string | null; avatar_id: number | null } | null;
}

// ---------- Perfil ----------

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Como getProfile, mas traz needs_username — usado pela guarda de (tabs)/_layout.tsx. */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_id, needs_username')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Usado só por choose-username.tsx: define o @usuário definitivo e libera o app. */
export async function setUsernameAndClearFlag(userId: string, username: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ username: username.trim(), needs_username: false })
    .eq('id', userId);
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Esse nome de usuário já está em uso.');
    }
    throw error;
  }
}

export async function updateAvatar(userId: string, avatarId: number | null) {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_id: avatarId })
    .eq('id', userId);
  if (error) throw error;
}

export async function updateDisplayName(userId: string, displayName: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('id', userId);
  if (error) throw error;
}

/** Sincroniza o idioma ativo do app para as Edge Functions de push notificarem no idioma certo. */
export async function updateLanguage(userId: string, language: 'pt-BR' | 'en-US') {
  const { error } = await supabase.from('profiles').update({ language }).eq('id', userId);
  if (error) throw error;
}

/** Apaga a conta autenticada e todos os dados dela (via Edge Function delete-account). */
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
}

// ---------- Séries seguidas ----------

export async function getFollowedShows(userId: string): Promise<FollowedShow[]> {
  const { data, error } = await supabase
    .from('followed_shows')
    .select('tmdb_id, name, name_en, poster_path, followed_at')
    .eq('user_id', userId)
    .order('followed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function isFollowing(userId: string, tmdbId: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('followed_shows')
    .select('tmdb_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function followShow(
  userId: string,
  show: { tmdb_id: number; name: string; name_en: string; poster_path: string | null }
) {
  const { error } = await supabase
    .from('followed_shows')
    .insert({ user_id: userId, ...show });
  if (error) throw error;
}

export async function unfollowShow(userId: string, tmdbId: number) {
  const { error } = await supabase
    .from('followed_shows')
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
}

// ---------- Episódios assistidos ----------

/**
 * Notifica telas abertas (temporada, watchlist) assim que uma escrita de
 * "assistido" é confirmada no banco. Evita que um refetch disparado por
 * navegação (ex.: voltar da tela do episódio para a temporada) chegue antes
 * da escrita e mostre o estado antigo — o refetch por foco é sujeito a essa
 * corrida, o evento não, porque só dispara depois da escrita terminar.
 */
type WatchedChangeListener = (
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumbers: number[] | 'all',
  watched: boolean
) => void;

const watchedChangeListeners = new Set<WatchedChangeListener>();

export function onEpisodeWatchedChange(listener: WatchedChangeListener) {
  watchedChangeListeners.add(listener);
  return () => {
    watchedChangeListeners.delete(listener);
  };
}

function emitEpisodeWatchedChange(
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumbers: number[] | 'all',
  watched: boolean
) {
  for (const listener of watchedChangeListeners) listener(tmdbShowId, seasonNumber, episodeNumbers, watched);
}

export async function getWatchedEpisodes(
  userId: string,
  tmdbShowId: number
): Promise<{ season_number: number; episode_number: number }[]> {
  const { data, error } = await supabase
    .from('watched_episodes')
    .select('season_number, episode_number')
    .eq('user_id', userId)
    .eq('tmdb_show_id', tmdbShowId);
  if (error) throw error;
  return data ?? [];
}

export async function isEpisodeWatched(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<boolean> {
  const { count, error } = await supabase
    .from('watched_episodes')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber)
    .eq('episode_number', episodeNumber);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function markEpisodeWatched(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  watched: boolean
) {
  if (watched) {
    const { error } = await supabase.from('watched_episodes').upsert({
      user_id: userId,
      tmdb_show_id: tmdbShowId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('watched_episodes')
      .delete()
      .eq('user_id', userId)
      .eq('tmdb_show_id', tmdbShowId)
      .eq('season_number', seasonNumber)
      .eq('episode_number', episodeNumber);
    if (error) throw error;
  }
  emitEpisodeWatchedChange(tmdbShowId, seasonNumber, [episodeNumber], watched);
}

/**
 * Marca vários episódios de uma temporada de uma vez (ex.: "marcar temporada
 * como assistida"). Upsert ignora os que já estavam marcados.
 */
export async function markSeasonWatched(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumbers: number[]
) {
  if (episodeNumbers.length === 0) return;
  const { error } = await supabase.from('watched_episodes').upsert(
    episodeNumbers.map((episodeNumber) => ({
      user_id: userId,
      tmdb_show_id: tmdbShowId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    })),
    { onConflict: 'user_id,tmdb_show_id,season_number,episode_number', ignoreDuplicates: true }
  );
  if (error) throw error;
  emitEpisodeWatchedChange(tmdbShowId, seasonNumber, episodeNumbers, true);
}

/** Desmarca todos os episódios de uma temporada. */
export async function unmarkSeasonWatched(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number
) {
  const { error } = await supabase
    .from('watched_episodes')
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber);
  if (error) throw error;
  emitEpisodeWatchedChange(tmdbShowId, seasonNumber, 'all', false);
}

// ---------- Filmes assistidos ----------

export interface WatchedMovie {
  tmdb_id: number;
  title: string;
  /** Título em inglês; `null` em registros antigos ainda não migrados. */
  title_en: string | null;
  poster_path: string | null;
  watched_at: string;
}

export async function getWatchedMovies(userId: string): Promise<WatchedMovie[]> {
  const { data, error } = await supabase
    .from('watched_movies')
    .select('tmdb_id, title, title_en, poster_path, watched_at')
    .eq('user_id', userId)
    .order('watched_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function isMovieWatched(userId: string, tmdbId: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('watched_movies')
    .select('tmdb_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function markMovieWatched(
  userId: string,
  movie: { tmdb_id: number; title: string; title_en: string; poster_path: string | null },
  watched: boolean
) {
  if (watched) {
    const { error } = await supabase
      .from('watched_movies')
      .upsert({ user_id: userId, ...movie }, { onConflict: 'user_id,tmdb_id' });
    if (error) throw error;
    // Assistiu? Sai do "Para assistir" (falha aqui não desfaz a marcação).
    await removeMovieFromWatchlist(userId, movie.tmdb_id).catch(() => {});
  } else {
    const { error } = await supabase
      .from('watched_movies')
      .delete()
      .eq('user_id', userId)
      .eq('tmdb_id', movie.tmdb_id);
    if (error) throw error;
  }
}

// ---------- Favoritos ----------

export interface FavoriteItem {
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  /** Título em inglês; `null` em registros antigos ainda não migrados. */
  title_en: string | null;
  poster_path: string | null;
  favorited_at: string;
}

export async function getFavorites(userId: string): Promise<FavoriteItem[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select('media_type, tmdb_id, title, title_en, poster_path, favorited_at')
    .eq('user_id', userId)
    .order('favorited_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function isFavorite(
  userId: string,
  mediaType: MediaType,
  tmdbId: number
): Promise<boolean> {
  const { count, error } = await supabase
    .from('favorites')
    .select('tmdb_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('media_type', mediaType)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function addFavorite(
  userId: string,
  item: {
    media_type: MediaType;
    tmdb_id: number;
    title: string;
    title_en: string;
    poster_path: string | null;
  }
) {
  const { error } = await supabase
    .from('favorites')
    .upsert({ user_id: userId, ...item }, { onConflict: 'user_id,media_type,tmdb_id' });
  if (error) throw error;
}

export async function removeFavorite(userId: string, mediaType: MediaType, tmdbId: number) {
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('media_type', mediaType)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
}

// ---------- Filmes para assistir ----------

export interface WatchlistMovie {
  tmdb_id: number;
  title: string;
  /** Título em inglês; `null` em registros antigos ainda não migrados. */
  title_en: string | null;
  poster_path: string | null;
  added_at: string;
}

export async function getWatchlistMovies(userId: string): Promise<WatchlistMovie[]> {
  const { data, error } = await supabase
    .from('watchlist_movies')
    .select('tmdb_id, title, title_en, poster_path, added_at')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function isMovieInWatchlist(userId: string, tmdbId: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('watchlist_movies')
    .select('tmdb_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function addMovieToWatchlist(
  userId: string,
  movie: { tmdb_id: number; title: string; title_en: string; poster_path: string | null }
) {
  const { error } = await supabase
    .from('watchlist_movies')
    .upsert({ user_id: userId, ...movie }, { onConflict: 'user_id,tmdb_id' });
  if (error) throw error;
}

export async function removeMovieFromWatchlist(userId: string, tmdbId: number) {
  const { error } = await supabase
    .from('watchlist_movies')
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
}

// ---------- Notas de episódios ----------

export async function getMyEpisodeRating(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  mediaType: MediaType = 'tv'
): Promise<number | null> {
  const { data, error } = await supabase
    .from('episode_ratings')
    .select('rating')
    .eq('user_id', userId)
    .eq('media_type', mediaType)
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber)
    .eq('episode_number', episodeNumber)
    .maybeSingle();
  if (error) throw error;
  return data?.rating ?? null;
}

export async function getEpisodeAverageRating(
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  mediaType: MediaType = 'tv'
): Promise<{ average: number; count: number }> {
  const { data, error } = await supabase
    .from('episode_ratings')
    .select('rating')
    .eq('media_type', mediaType)
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber)
    .eq('episode_number', episodeNumber);
  if (error) throw error;
  const ratings = data ?? [];
  const count = ratings.length;
  const average = count > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  return { average, count };
}

export async function rateEpisode(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  rating: number,
  mediaType: MediaType = 'tv'
) {
  const { error } = await supabase.from('episode_ratings').upsert({
    user_id: userId,
    media_type: mediaType,
    tmdb_show_id: tmdbShowId,
    season_number: seasonNumber,
    episode_number: episodeNumber,
    rating,
  });
  if (error) throw error;
}

// ---------- Comentários ----------

/** Comentários do episódio, com contagem de curtidas, ordenados pelos mais curtidos primeiro. */
export async function getEpisodeComments(
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  viewerId: string,
  mediaType: MediaType = 'tv'
): Promise<EpisodeComment[]> {
  // O nome do FK desambigua o join: depois de comment_likes/comment_reports
  // existirem, há mais de um caminho entre episode_comments e profiles, e o
  // PostgREST recusa o embed sem essa dica.
  const { data, error } = await supabase
    .from('episode_comments')
    .select('id, user_id, tmdb_show_id, season_number, episode_number, content, image_url, created_at, parent_id, profiles!episode_comments_user_id_fkey(username, display_name, avatar_id)')
    .eq('media_type', mediaType)
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber)
    .eq('episode_number', episodeNumber);
  if (error) throw error;
  const comments = (data as unknown as Omit<EpisodeComment, 'like_count' | 'liked_by_me'>[]) ?? [];
  if (comments.length === 0) return [];

  const { data: likeRows, error: likesError } = await supabase
    .from('comment_likes')
    .select('comment_id, user_id')
    .in(
      'comment_id',
      comments.map((c) => c.id)
    );
  if (likesError) throw likesError;

  const likeCounts = new Map<string, number>();
  const likedByMe = new Set<string>();
  for (const row of likeRows ?? []) {
    likeCounts.set(row.comment_id, (likeCounts.get(row.comment_id) ?? 0) + 1);
    if (row.user_id === viewerId) likedByMe.add(row.comment_id);
  }

  return comments
    .map((c) => ({
      ...c,
      like_count: likeCounts.get(c.id) ?? 0,
      liked_by_me: likedByMe.has(c.id),
    }))
    .sort((a, b) => b.like_count - a.like_count || b.created_at.localeCompare(a.created_at));
}

export async function likeComment(commentId: string, userId: string) {
  const { error } = await supabase
    .from('comment_likes')
    .insert({ comment_id: commentId, user_id: userId });
  if (error) throw error;
}

export async function unlikeComment(commentId: string, userId: string) {
  const { error } = await supabase
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function reportComment(commentId: string, reporterId: string) {
  const { error } = await supabase
    .from('comment_reports')
    .insert({ comment_id: commentId, reporter_id: reporterId });
  if (error) throw error;
}

/** Sinaliza o comentário de outra pessoa como spoiler (com 3+ sinalizações ele é ocultado pra todo mundo). */
export async function markCommentSpoiler(commentId: string, userId: string) {
  const { error } = await supabase
    .from('comment_spoiler_flags')
    .insert({ comment_id: commentId, user_id: userId });
  if (error) throw error;
}

export async function addEpisodeComment(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  content: string,
  imageUrl?: string | null,
  parentId?: string | null,
  mediaType: MediaType = 'tv'
): Promise<string> {
  const { data, error } = await supabase
    .from('episode_comments')
    .insert({
      user_id: userId,
      media_type: mediaType,
      tmdb_show_id: tmdbShowId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
      content,
      image_url: imageUrl ?? null,
      parent_id: parentId ?? null,
    })
    .select('id')
    .single();
  if (error) {
    // Os limites anti-spam vêm do trigger enforce_comment_limits, que já
    // levanta exceção com mensagem amigável em português (repassada abaixo).
    // Código 23514 = restrição (CHECK) violada — a única que o usuário pode
    // disparar sozinho é a de links, já que a de tamanho é limitada pelo input.
    if (error.code === '23514' && error.message?.includes('episode_comments_no_urls_check')) {
      throw new Error('Comentários não podem conter links.');
    }
    throw error;
  }
  return data.id;
}

export async function deleteEpisodeComment(commentId: string) {
  const { error } = await supabase.from('episode_comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ---------- Importação TV Time ----------

const IMPORT_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function followShowsBulk(
  userId: string,
  shows: { tmdb_id: number; name: string; name_en: string; poster_path: string | null }[]
) {
  if (shows.length === 0) return;
  const { error } = await supabase
    .from('followed_shows')
    .upsert(
      shows.map((show) => ({ user_id: userId, ...show })),
      { onConflict: 'user_id,tmdb_id', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function importWatchedMoviesBulk(
  userId: string,
  movies: {
    tmdb_id: number;
    title: string;
    title_en: string;
    poster_path: string | null;
    watched_at: string | null;
  }[]
) {
  if (movies.length === 0) return;
  for (const batch of chunk(movies, IMPORT_CHUNK_SIZE)) {
    const { error } = await supabase.from('watched_movies').upsert(
      batch.map((movie) => ({
        user_id: userId,
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        title_en: movie.title_en,
        poster_path: movie.poster_path,
        ...(movie.watched_at ? { watched_at: movie.watched_at } : {}),
      })),
      { onConflict: 'user_id,tmdb_id' }
    );
    if (error) throw error;
  }
}

// ---------- Amigos ----------

// Contas usadas para revisão nas lojas (Google Play / App Store) — não devem
// aparecer na busca de amigos dos usuários reais.
const REVIEWER_USERNAMES = ['nagib Googleplay', 'revisor_apple'];

export async function searchProfiles(query: string, excludeUserId: string): Promise<Profile[]> {
  // Vírgulas e parênteses têm significado especial no filtro .or() do PostgREST.
  const term = query.replace(/[,()]/g, ' ').trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_id')
    .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
    .neq('id', excludeUserId)
    .not('username', 'in', `(${REVIEWER_USERNAMES.map((name) => `"${name}"`).join(',')})`)
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** Amigos confirmados (pedido aceito dos dois lados). */
export async function getFriends(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name, avatar_id)')
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que outras pessoas mandaram para mim e ainda não respondi. */
export async function getIncomingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_follower_id_fkey(id, username, display_name, avatar_id)')
    .eq('followed_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que eu mandei e ainda estão aguardando resposta. */
export async function getOutgoingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name, avatar_id)')
    .eq('follower_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Envia um pedido de amizade. Se a outra pessoa já tinha pedido pra mim, aceita na hora. */
export async function sendFriendRequest(userId: string, targetId: string) {
  const { data: reverse, error: reverseError } = await supabase
    .from('user_follows')
    .select('status')
    .eq('follower_id', targetId)
    .eq('followed_id', userId)
    .maybeSingle();
  if (reverseError) throw reverseError;

  if (reverse) {
    await acceptFriendRequest(userId, targetId);
    return;
  }

  const { error } = await supabase
    .from('user_follows')
    .insert({ follower_id: userId, followed_id: targetId, status: 'pending' });
  if (error) throw error;
}

/** Aceita o pedido de `requesterId`, tornando a amizade mútua. */
export async function acceptFriendRequest(userId: string, requesterId: string) {
  const { error: updateError } = await supabase
    .from('user_follows')
    .update({ status: 'accepted' })
    .eq('follower_id', requesterId)
    .eq('followed_id', userId);
  if (updateError) throw updateError;

  const { error: insertError } = await supabase
    .from('user_follows')
    .upsert(
      { follower_id: userId, followed_id: requesterId, status: 'accepted' },
      { onConflict: 'follower_id,followed_id' }
    );
  if (insertError) throw insertError;
}

/** Recusa um pedido recebido, ou cancela um pedido que eu mandei. */
export async function removeFriendRequest(userId: string, otherId: string) {
  const { error } = await supabase
    .from('user_follows')
    .delete()
    .or(
      `and(follower_id.eq.${userId},followed_id.eq.${otherId}),and(follower_id.eq.${otherId},followed_id.eq.${userId})`
    );
  if (error) throw error;
}

// ---------- Bloqueio de usuários ----------

/** Bloqueia e desfaz qualquer amizade/pedido pendente entre os dois. */
export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;

  await supabase
    .from('user_follows')
    .delete()
    .or(
      `and(follower_id.eq.${blockerId},followed_id.eq.${blockedId}),and(follower_id.eq.${blockedId},followed_id.eq.${blockerId})`
    );
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

export async function getBlockedUsers(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_blocks')
    .select('profiles!user_blocks_blocked_id_fkey(id, username, display_name, avatar_id)')
    .eq('blocker_id', userId);
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

// ---------- Telefone / achar amigos pelos contatos ----------

export async function getMyPhoneNumber(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('phone_contacts')
    .select('phone_number')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.phone_number ?? null;
}

/** Grava o telefone (já em E.164) via Edge Function — a tabela não aceita insert/update direto. */
export async function setPhoneNumber(phoneNumber: string) {
  const { error } = await supabase.functions.invoke('set-phone-number', {
    body: { phone_number: phoneNumber },
  });
  if (error) throw await edgeFunctionError(error, 'Não foi possível salvar o telefone.');
}

export async function removePhoneNumber(userId: string) {
  const { error } = await supabase.from('phone_contacts').delete().eq('user_id', userId);
  if (error) throw error;
}

const CONTACT_HASH_BATCH_SIZE = 800;

/** Manda os hashes SHA-256 dos contatos do celular (nunca o telefone em si) e recebe os perfis que baterem. */
export async function matchContacts(hashes: string[]): Promise<Profile[]> {
  const matches = new Map<string, Profile>();
  for (let i = 0; i < hashes.length; i += CONTACT_HASH_BATCH_SIZE) {
    const batch = hashes.slice(i, i + CONTACT_HASH_BATCH_SIZE);
    const { data, error } = await supabase.functions.invoke<{ matches: Profile[] }>('match-contacts', {
      body: { hashes: batch },
    });
    if (error) throw await edgeFunctionError(error, 'Não foi possível buscar nos contatos.');
    for (const profile of data?.matches ?? []) matches.set(profile.id, profile);
  }
  return Array.from(matches.values());
}

// ---------- Feed social ----------

export interface FeedWatchedItem {
  type: 'watched';
  user: Profile;
  tmdb_show_id: number;
  /** Episódios assistidos no mesmo dia, agrupados (estilo TV Time). */
  episodes: { season_number: number; episode_number: number }[];
  date: string;
  like_count: number;
  liked_by_me: boolean;
}

export interface FeedWatchedMovieItem {
  type: 'watched_movie';
  user: Profile;
  tmdb_id: number;
  title: string;
  /** Título em inglês; `null` em registros antigos ainda não migrados. */
  title_en: string | null;
  poster_path: string | null;
  date: string;
  like_count: number;
  liked_by_me: boolean;
}

export interface FeedCommentItem {
  type: 'comment';
  user: Profile;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  content: string;
  image_url: string | null;
  date: string;
}

export type FeedItem = FeedWatchedItem | FeedWatchedMovieItem | FeedCommentItem;

/** Chave que identifica a atividade "assistiu" curtível (série ou filme) no feed. */
export function feedActivityIdentity(item: FeedWatchedItem | FeedWatchedMovieItem) {
  return {
    owner_id: item.user.id,
    media_type: (item.type === 'watched_movie' ? 'movie' : 'tv') as MediaType,
    tmdb_id: item.type === 'watched_movie' ? item.tmdb_id : item.tmdb_show_id,
    activity_date: item.date.slice(0, 10),
  };
}

function feedActivityKey(id: ReturnType<typeof feedActivityIdentity>) {
  return `${id.owner_id}:${id.media_type}:${id.tmdb_id}:${id.activity_date}`;
}

/**
 * Monta o feed com a atividade recente dos usuários que sigo: séries e
 * filmes assistidos (agrupados por dia) e comentários.
 */
export async function getFriendsFeed(userId: string): Promise<FeedItem[]> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return [];
  const friendById = new Map(friends.map((f) => [f.id, f]));
  const friendIds = friends.map((f) => f.id);

  const [watchedRes, moviesRes, commentsRes] = await Promise.all([
    supabase
      .from('watched_episodes')
      .select('user_id, tmdb_show_id, season_number, episode_number, watched_at')
      .in('user_id', friendIds)
      .order('watched_at', { ascending: false })
      .limit(120),
    supabase
      .from('watched_movies')
      .select('user_id, tmdb_id, title, title_en, poster_path, watched_at')
      .in('user_id', friendIds)
      .order('watched_at', { ascending: false })
      .limit(60),
    supabase
      .from('episode_comments')
      .select('user_id, tmdb_show_id, season_number, episode_number, content, image_url, created_at')
      // O feed renderiza séries (busca detalhes por tmdb_show_id); comentários
      // de filmes ficam de fora por enquanto.
      .eq('media_type', 'tv')
      .in('user_id', friendIds)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);
  if (watchedRes.error) throw watchedRes.error;
  if (moviesRes.error) throw moviesRes.error;
  if (commentsRes.error) throw commentsRes.error;

  // Agrupa episódios assistidos pelo mesmo usuário, na mesma série e no mesmo dia.
  const watchedGroups = new Map<string, FeedWatchedItem>();
  for (const row of watchedRes.data ?? []) {
    const user = friendById.get(row.user_id);
    if (!user) continue;
    const day = row.watched_at.slice(0, 10);
    const key = `${row.user_id}:${row.tmdb_show_id}:${day}`;
    const group = watchedGroups.get(key);
    if (group) {
      group.episodes.push({
        season_number: row.season_number,
        episode_number: row.episode_number,
      });
    } else {
      watchedGroups.set(key, {
        type: 'watched',
        user,
        tmdb_show_id: row.tmdb_show_id,
        episodes: [{ season_number: row.season_number, episode_number: row.episode_number }],
        date: row.watched_at,
        like_count: 0,
        liked_by_me: false,
      });
    }
  }

  const movieItems: FeedWatchedMovieItem[] = (moviesRes.data ?? [])
    .filter((row) => friendById.has(row.user_id))
    .map((row) => ({
      type: 'watched_movie',
      user: friendById.get(row.user_id)!,
      tmdb_id: row.tmdb_id,
      title: row.title,
      title_en: row.title_en,
      poster_path: row.poster_path,
      date: row.watched_at,
      like_count: 0,
      liked_by_me: false,
    }));

  const comments: FeedCommentItem[] = (commentsRes.data ?? [])
    .filter((row) => friendById.has(row.user_id))
    .map((row) => ({
      type: 'comment',
      user: friendById.get(row.user_id)!,
      tmdb_show_id: row.tmdb_show_id,
      season_number: row.season_number,
      episode_number: row.episode_number,
      content: row.content,
      image_url: row.image_url,
      date: row.created_at,
    }));

  // Curtidas das atividades "assistiu" carregadas acima.
  const likeable = [...watchedGroups.values(), ...movieItems];
  if (likeable.length > 0) {
    const minDate = likeable.reduce(
      (min, it) => (it.date.slice(0, 10) < min ? it.date.slice(0, 10) : min),
      likeable[0].date.slice(0, 10)
    );
    const { data: likeRows, error: likesError } = await supabase
      .from('feed_likes')
      .select('liker_id, owner_id, media_type, tmdb_id, activity_date')
      .in('owner_id', friendIds)
      .gte('activity_date', minDate);
    if (likesError) throw likesError;

    const likeCounts = new Map<string, number>();
    const likedByMe = new Set<string>();
    for (const row of likeRows ?? []) {
      const key = `${row.owner_id}:${row.media_type}:${row.tmdb_id}:${row.activity_date}`;
      likeCounts.set(key, (likeCounts.get(key) ?? 0) + 1);
      if (row.liker_id === userId) likedByMe.add(key);
    }
    for (const item of likeable) {
      const key = feedActivityKey(feedActivityIdentity(item));
      item.like_count = likeCounts.get(key) ?? 0;
      item.liked_by_me = likedByMe.has(key);
    }
  }

  return [...watchedGroups.values(), ...movieItems, ...comments].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
}

export async function likeFeedActivity(likerId: string, item: FeedWatchedItem | FeedWatchedMovieItem) {
  const id = feedActivityIdentity(item);
  const { error } = await supabase.from('feed_likes').insert({
    liker_id: likerId,
    owner_id: id.owner_id,
    media_type: id.media_type,
    tmdb_id: id.tmdb_id,
    activity_date: id.activity_date,
  });
  if (error) throw error;
}

export async function unlikeFeedActivity(likerId: string, item: FeedWatchedItem | FeedWatchedMovieItem) {
  const id = feedActivityIdentity(item);
  const { error } = await supabase
    .from('feed_likes')
    .delete()
    .eq('liker_id', likerId)
    .eq('owner_id', id.owner_id)
    .eq('media_type', id.media_type)
    .eq('tmdb_id', id.tmdb_id)
    .eq('activity_date', id.activity_date);
  if (error) throw error;
}

// ---------- Ranking de tempo assistido (amigos) ----------

export interface FriendEpisodeCount {
  user_id: string;
  tmdb_show_id: number;
  episode_count: number;
}

/** Episódios assistidos por (usuário, série) desde `since` (null = desde sempre). Só retorna o próprio usuário e amigos aceitos (RLS). */
export async function getFriendsEpisodeCounts(
  userIds: string[],
  since: Date | null
): Promise<FriendEpisodeCount[]> {
  const { data, error } = await supabase.rpc('get_friends_episode_counts', {
    target_user_ids: userIds,
    since: since ? since.toISOString() : null,
  });
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string; tmdb_show_id: number; episode_count: number | string }) => ({
    user_id: row.user_id,
    tmdb_show_id: row.tmdb_show_id,
    episode_count: Number(row.episode_count),
  }));
}

export interface FriendMovieWatch {
  user_id: string;
  tmdb_id: number;
}

/** Filmes assistidos por usuário desde `since` (null = desde sempre). Só retorna o próprio usuário e amigos aceitos (RLS). */
export async function getFriendsMovieWatches(
  userIds: string[],
  since: Date | null
): Promise<FriendMovieWatch[]> {
  const { data, error } = await supabase.rpc('get_friends_movie_watches', {
    target_user_ids: userIds,
    since: since ? since.toISOString() : null,
  });
  if (error) throw error;
  return data ?? [];
}

// ---------- Push tokens ----------

export async function savePushToken(userId: string, token: string, platform: 'ios' | 'android') {
  const { error } = await supabase.from('push_tokens').upsert({
    user_id: userId,
    token,
    platform,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function deletePushToken(userId: string, token: string) {
  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token);
  if (error) throw error;
}

// ---------- Estatísticas ----------

export interface WatchedCount {
  tmdb_show_id: number;
  episode_count: number;
  /** Quando o episódio mais recente da série foi marcado como assistido. */
  last_watched_at: string | null;
}

export async function getWatchedCounts(): Promise<WatchedCount[]> {
  const { data, error } = await supabase.rpc('get_watched_counts');
  if (error) throw error;
  return (data ?? []).map(
    (row: { tmdb_show_id: number; episode_count: number | string; last_watched_at: string | null }) => ({
      tmdb_show_id: row.tmdb_show_id,
      episode_count: Number(row.episode_count),
      last_watched_at: row.last_watched_at,
    })
  );
}

export async function importWatchedEpisodesBulk(
  userId: string,
  tmdbShowId: number,
  episodes: { season_number: number; episode_number: number; watched_at: string | null }[]
) {
  for (const batch of chunk(episodes, IMPORT_CHUNK_SIZE)) {
    const { error } = await supabase.from('watched_episodes').upsert(
      batch.map((episode) => ({
        user_id: userId,
        tmdb_show_id: tmdbShowId,
        season_number: episode.season_number,
        episode_number: episode.episode_number,
        ...(episode.watched_at ? { watched_at: episode.watched_at } : {}),
      })),
      { onConflict: 'user_id,tmdb_show_id,season_number,episode_number' }
    );
    if (error) throw error;
  }
}

// ---------- Curtidas recebidas (notificações) ----------

export interface FeedLikeNotification {
  liker: Profile;
  media_type: MediaType;
  tmdb_id: number;
  activity_date: string;
  created_at: string;
}

/** Curtidas que os amigos deram no que eu assisti, mais recentes primeiro. */
export async function getFeedLikesReceived(userId: string): Promise<FeedLikeNotification[]> {
  const { data, error } = await supabase
    .from('feed_likes')
    .select(
      'media_type, tmdb_id, activity_date, created_at, profiles!feed_likes_liker_id_fkey(id, username, display_name, avatar_id)'
    )
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (
    (data as unknown as {
      media_type: MediaType;
      tmdb_id: number;
      activity_date: string;
      created_at: string;
      profiles: Profile;
    }[]) ?? []
  ).map((row) => ({
    liker: row.profiles,
    media_type: row.media_type,
    tmdb_id: row.tmdb_id,
    activity_date: row.activity_date,
    created_at: row.created_at,
  }));
}

/** Quantas curtidas recebi desde a data informada (ou todas, se null) — alimenta o sininho. */
export async function getFeedLikesCountSince(userId: string, since: string | null): Promise<number> {
  let query = supabase
    .from('feed_likes')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', userId);
  if (since) query = query.gt('created_at', since);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Título/pôster dos filmes que assisti, para exibir nas curtidas recebidas (sem chamar a TMDB). */
export async function getWatchedMoviesByIds(
  userId: string,
  tmdbIds: number[]
): Promise<
  { tmdb_id: number; title: string; title_en: string | null; poster_path: string | null }[]
> {
  if (tmdbIds.length === 0) return [];
  const { data, error } = await supabase
    .from('watched_movies')
    .select('tmdb_id, title, title_en, poster_path')
    .eq('user_id', userId)
    .in('tmdb_id', tmdbIds);
  if (error) throw error;
  return data ?? [];
}

// ---------- Preferências de notificação ----------

export interface NotificationPreferences {
  new_episodes: boolean;
  friend_requests: boolean;
  friend_accepted: boolean;
  feed_likes: boolean;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  new_episodes: true,
  friend_requests: true,
  friend_accepted: true,
  feed_likes: true,
};

/** Ausência de linha = tudo ativado (mesmo padrão do trigger em supabase/schema.sql). */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('new_episodes, friend_requests, friend_accepted, feed_likes')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

export async function updateNotificationPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
) {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
}
