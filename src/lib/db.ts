/**
 * Consultas ao banco (Supabase). Tabelas definidas em supabase/schema.sql.
 */

import { supabase } from './supabase';

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
}

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
  profiles: { username: string; display_name: string | null } | null;
}

// ---------- Perfil ----------

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
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
): Promise<{ season_number: number; episode_number: number }[]> {
  const { data, error } = await supabase
    .from('watched_episodes')
    .select('season_number, episode_number')
    .eq('user_id', userId)
    .eq('tmdb_show_id', tmdbShowId);
  if (error) throw error;
  return data ?? [];
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

// ---------- Notas de episódios ----------

export async function getMyEpisodeRating(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<number | null> {
  const { data, error } = await supabase
    .from('episode_ratings')
    .select('rating')
    .eq('user_id', userId)
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
  episodeNumber: number
): Promise<{ average: number; count: number }> {
  const { data, error } = await supabase
    .from('episode_ratings')
    .select('rating')
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
  rating: number
) {
  const { error } = await supabase.from('episode_ratings').upsert({
    user_id: userId,
    tmdb_show_id: tmdbShowId,
    season_number: seasonNumber,
    episode_number: episodeNumber,
    rating,
  });
  if (error) throw error;
}

// ---------- Comentários ----------

export async function getEpisodeComments(
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<EpisodeComment[]> {
  const { data, error } = await supabase
    .from('episode_comments')
    .select('id, user_id, tmdb_show_id, season_number, episode_number, content, image_url, created_at, profiles(username, display_name)')
    .eq('tmdb_show_id', tmdbShowId)
    .eq('season_number', seasonNumber)
    .eq('episode_number', episodeNumber)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as EpisodeComment[]) ?? [];
}

export async function addEpisodeComment(
  userId: string,
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number,
  content: string,
  imageUrl?: string | null
) {
  const { error } = await supabase.from('episode_comments').insert({
    user_id: userId,
    tmdb_show_id: tmdbShowId,
    season_number: seasonNumber,
    episode_number: episodeNumber,
    content,
    image_url: imageUrl ?? null,
  });
  if (error) throw error;
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

// ---------- Amigos ----------

export async function searchProfiles(query: string, excludeUserId: string): Promise<Profile[]> {
  // Vírgulas e parênteses têm significado especial no filtro .or() do PostgREST.
  const term = query.replace(/[,()]/g, ' ').trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
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
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name)')
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que outras pessoas mandaram para mim e ainda não respondi. */
export async function getIncomingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_follower_id_fkey(id, username, display_name)')
    .eq('followed_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return ((data as unknown as { profiles: Profile }[]) ?? []).map((row) => row.profiles);
}

/** Pedidos que eu mandei e ainda estão aguardando resposta. */
export async function getOutgoingFriendRequests(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('profiles!user_follows_followed_id_fkey(id, username, display_name)')
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
  episode_count: number;
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
