/**
 * Upload de mídia (imagem/GIF de comentários) para o Supabase Storage.
 * Bucket público "comment-media", definido em supabase/schema.sql.
 */

import { File } from 'expo-file-system';

import { supabase } from './supabase';

const BUCKET = 'comment-media';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Envia a imagem local para o Storage e retorna a URL pública.
 * O caminho começa com o id do usuário — exigido pela política RLS do bucket.
 */
export async function uploadCommentImage(
  userId: string,
  localUri: string,
  mimeType?: string | null
): Promise<string> {
  const uriExt = localUri.split('.').pop()?.toLowerCase() ?? '';
  const contentType = mimeType ?? EXT_TO_MIME[uriExt] ?? 'image/jpeg';
  const ext = MIME_TO_EXT[contentType] ?? 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const bytes = await new File(localUri).bytes();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType });
  if (error) throw error;

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
