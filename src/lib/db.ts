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

export interface FollowedShow {
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  followed_at: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  /** Índice do avatar escolhido (1–36, ver src/lib/avatars.ts); null = sem avatar. */
  avatar_id: number | null;
  /** Assinatura premium ativa (mantido pelo webhook do RevenueCat). */
  is_premium?: boolean;
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
  profiles: {
    username: string;
    display_name: string | null;
    avatar_id: number | null;
    is_premium?: boolean;
  } | null;
}

// ---------- Perfil ----------

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_id, is_premium')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
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

/** Apaga a conta autenticada e todos os dados dela (via Edge Function delete-account). */
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
}

// ---------- Séries seguidas ----------

export async function getFollowedShows(userId: string): Promise<FollowedShow[]> {
  const { data, error } = await supabase
    .from('followed_shows')
    .select('tmdb_id, name, poster_path, followed_at')
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
  show: { tmdb_id: number; name: string; poster_path: string | null }
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

export async function getWatchedEpisodes(
  userId: string,
  tmdbShowId: number
): Promise<{ season_number: number; episode_number: number; watch_count: number }[]> {
  const { data, error } = await supabase
    .from('watched_episodes')
    .select('season_number, episode_number, watch_count')
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
}

/**
 * "Vi de novo" (premium): soma +1 no contador dos episódios, criando a
 * marcação para os que ainda não estavam vistos. O banco recusa contagens
 * acima de 1 para quem não é premium (trigger enforce_premium_rewatch).
 */
export async function rewatchEpisodes(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumbers: number[]
) {
  if (episodeNumbers.length === 0) return;
  const { error } = await supabase.rpc('rewatch_episodes', {
    p_show_id: tmdbShowId,
    p_season: seasonNumber,
    p_episodes: episodeNumbers,
  });
  if (error) throw error;
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
}

// ---------- Filmes assistidos ----------

export interface WatchedMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  watched_at: string;
  /** Quantas vezes foi visto (revisões premium contam de novo). */
  watch_count: number;
}

export async function getWatchedMovies(userId: string): Promise<WatchedMovie[]> {
  const { data, error } = await supabase
    .from('watched_movies')
    .select('tmdb_id, title, poster_path, watched_at, watch_count')
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

/** Quantas vezes o usuário viu o filme (0 = não assistiu). */
export async function getMovieWatchCount(userId: string, tmdbId: number): Promise<number> {
  const { data, error } = await supabase
    .from('watched_movies')
    .select('watch_count')
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId)
    .maybeSingle();
  if (error) throw error;
  return data?.watch_count ?? 0;
}

/** "Vi de novo" (premium): soma +1 no contador do filme e devolve o novo total. */
export async function rewatchMovie(
  userId: string,
  movie: { tmdb_id: number; title: string; poster_path: string | null }
): Promise<number> {
  const { data, error } = await supabase.rpc('rewatch_movie', {
    p_tmdb_id: movie.tmdb_id,
    p_title: movie.title,
    p_poster_path: movie.poster_path,
  });
  if (error) throw error;
  return data ?? 1;
}

export async function markMovieWatched(
  userId: string,
  movie: { tmdb_id: number; title: string; poster_path: string | null },
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
  poster_path: string | null;
  favorited_at: string;
}

export async function getFavorites(userId: string): Promise<FavoriteItem[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select('media_type, tmdb_id, title, poster_path, favorited_at')
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
  item: { media_type: MediaType; tmdb_id: number; title: string; poster_path: string | null }
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
  poster_path: string | null;
  added_at: string;
}

export async function getWatchlistMovies(userId: string): Promise<WatchlistMovie[]> {
  const { data, error } = await supabase
    .from('watchlist_movies')
    .select('tmdb_id, title, poster_path, added_at')
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
  movie: { tmdb_id: number; title: string; poster_path: string | null }
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
    .select('id, user_id, tmdb_show_id, season_number, episode_number, content, image_url, created_at, parent_id, profiles!episode_comments_user_id_fkey(username, display_name, avatar_id, is_premium)')
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
  shows: { tmdb_id: number; name: string; poster_path: string | null }[]
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
  movies: { tmdb_id: number; title: string; poster_path: string | null; watched_at: string | null }[]
) {
  if (movies.length === 0) return;
  for (const batch of chunk(movies, IMPORT_CHUNK_SIZE)) {
    const { error } = await supabase.from('watched_movies').upsert(
      batch.map((movie) => ({
        user_id: userId,
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        poster_path: movie.poster_path,
        ...(movie.watched_at ? { watched_at: movie.watched_at } : {}),
      })),
      { onConflict: 'user_id,tmdb_id' }
    );
    if (error) throw error;
  }
}

// ---------- Amigos ----------

export async function searchProfiles(query: string, excludeUserId: string): Promise<Profile[]> {
  // Vírgulas e parênteses têm significado especial no filtro .or() do PostgREST.
  const term = query.replace(/[,()]/g, ' ').trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_id, is_premium')
    .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
    .neq('id', excludeUserId)
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** Amigos confirmados (pedido aceito dos dois lados). */
export async function getFriends(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name, avatar_id, is_premium)')
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que outras pessoas mandaram para mim e ainda não respondi. */
export async function getIncomingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_follower_id_fkey(id, username, display_name, avatar_id, is_premium)')
    .eq('followed_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que eu mandei e ainda estão aguardando resposta. */
export async function getOutgoingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name, avatar_id, is_premium)')
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

// ---------- Feed social ----------

export interface FeedWatchedItem {
  type: 'watched';
  user: Profile;
  tmdb_show_id: number;
  /** Episódios assistidos no mesmo dia, agrupados (estilo TV Time). */
  episodes: { season_number: number; episode_number: number }[];
  date: string;
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

export type FeedItem = FeedWatchedItem | FeedCommentItem;

/**
 * Monta o feed com a atividade recente dos usuários que sigo:
 * episódios assistidos (agrupados por série + dia) e comentários.
 */
export async function getFriendsFeed(userId: string): Promise<FeedItem[]> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return [];
  const friendById = new Map(friends.map((f) => [f.id, f]));
  const friendIds = friends.map((f) => f.id);

  const [watchedRes, commentsRes] = await Promise.all([
    supabase
      .from('watched_episodes')
      .select('user_id, tmdb_show_id, season_number, episode_number, watched_at')
      .in('user_id', friendIds)
      .order('watched_at', { ascending: false })
      .limit(120),
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
      });
    }
  }

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

  return [...watchedGroups.values(), ...comments].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
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
  /** Episódios distintos assistidos. */
  episode_count: number;
  /** Total de visualizações (revisões premium contam de novo). */
  view_count: number;
}

export async function getWatchedCounts(): Promise<WatchedCount[]> {
  const { data, error } = await supabase.rpc('get_watched_counts');
  if (error) throw error;
  return (data ?? []).map((row: { tmdb_show_id: number; episode_count: number | string }) => ({
    tmdb_show_id: row.tmdb_show_id,
    episode_count: Number(row.episode_count),
  }));
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
