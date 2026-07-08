import Ionicons from '@expo/vector-icons/Ionicons';
import { useHeaderHeight } from '@react-navigation/elements';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  addEpisodeComment,
  deleteEpisodeComment,
  getEpisodeAverageRating,
  getEpisodeComments,
  getMyEpisodeRating,
  profileDisplayName,
  rateEpisode,
  type EpisodeComment,
} from '@/lib/db';
import { uploadCommentImage } from '@/lib/storage';
import { getEpisodeDetails, stillUrl, type TmdbEpisode } from '@/lib/tmdb';

export default function EpisodeScreen() {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    showId: string;
    seasonNumber: string;
    episodeNumber: string;
  }>();
  const showId = Number(params.showId);
  const seasonNumber = Number(params.seasonNumber);
  const episodeNumber = Number(params.episodeNumber);

  const [episode, setEpisode] = useState<TmdbEpisode | null>(null);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [comments, setComments] = useState<EpisodeComment[] | null>(null);
  const [newComment, setNewComment] = useState('');
  const [attachment, setAttachment] = useState<{ uri: string; mimeType: string | null } | null>(
    null
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSocial = useCallback(async () => {
    const [avg, list] = await Promise.all([
      getEpisodeAverageRating(showId, seasonNumber, episodeNumber),
      getEpisodeComments(showId, seasonNumber, episodeNumber),
    ]);
    setAverage(avg);
    setComments(list);
  }, [showId, seasonNumber, episodeNumber]);

  useEffect(() => {
    getEpisodeDetails(showId, seasonNumber, episodeNumber)
      .then(setEpisode)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar o episódio.')
      );
    if (user) {
      getMyEpisodeRating(user.id, showId, seasonNumber, episodeNumber)
        .then(setMyRating)
        .catch(() => {});
    }
    loadSocial().catch(() => {});
  }, [showId, seasonNumber, episodeNumber, user, loadSocial]);

  async function handleRate(rating: number) {
    if (!user) return;
    setMyRating(rating);
    try {
      await rateEpisode(user.id, showId, seasonNumber, episodeNumber, rating);
      const avg = await getEpisodeAverageRating(showId, seasonNumber, episodeNumber);
      setAverage(avg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a nota.');
    }
  }

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      // Sem edição para preservar GIFs animados (o crop converteria em imagem parada).
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setAttachment({ uri: asset.uri, mimeType: asset.mimeType ?? null });
  }

  async function handleSendComment() {
    if (!user || (!newComment.trim() && !attachment)) return;
    setSending(true);
    try {
      let imageUrl: string | null = null;
      if (attachment) {
        imageUrl = await uploadCommentImage(user.id, attachment.uri, attachment.mimeType);
      }
      await addEpisodeComment(
        user.id,
        showId,
        seasonNumber,
        episodeNumber,
        newComment.trim(),
        imageUrl
      );
      setNewComment('');
      setAttachment(null);
      await loadSocial();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o comentário.');
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteEpisodeComment(commentId);
      await loadSocial();
    } catch {
      // Mantém a lista como está se a exclusão falhar.
    }
  }

  if (error && !episode) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!episode) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const still = stillUrl(episode.still_path, 'original');
  const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;

  return (
    <KeyboardAvoidingView
      // No Android o próprio sistema redimensiona a janela (adjustResize).
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Compensa a altura do header do navegador; sem isso o teclado cobre o campo.
      keyboardVerticalOffset={headerHeight}
      style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: code }} />
      <FlatList
        data={comments ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        // Arrastar a lista recolhe o teclado (no iOS, acompanha o dedo).
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        ListHeaderComponent={
          <View style={styles.header}>
            {still && <Image source={{ uri: still }} style={styles.still} contentFit="cover" />}
            <ThemedText type="smallBold" style={styles.title}>
              {code} — {episode.name}
            </ThemedText>
            {episode.air_date && (
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(`${episode.air_date}T00:00:00`).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
                {episode.runtime ? ` · ${episode.runtime} min` : ''}
              </ThemedText>
            )}
            {episode.overview ? (
              <ThemedText type="small" themeColor="textSecondary">
                {episode.overview}
              </ThemedText>
            ) : null}

            <View style={[styles.ratingCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Sua nota</ThemedText>
              <StarRating value={myRating} onChange={handleRate} />
              {average && average.count > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Média da comunidade: {average.average.toFixed(1)}/10 ({average.count}{' '}
                  {average.count === 1 ? 'voto' : 'votos'})
                </ThemedText>
              )}
            </View>

            {error && <ThemedText themeColor="danger">{error}</ThemedText>}

            <ThemedText type="smallBold" style={styles.commentsTitle}>
              Comentários {comments ? `(${comments.length})` : ''}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          comments === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.three }} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              Seja o primeiro a comentar este episódio!
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.comment, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.commentHeader}>
              <ThemedText type="smallBold">{profileDisplayName(item.profiles)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(item.created_at).toLocaleDateString('pt-BR')}
              </ThemedText>
            </View>
            {item.content ? <ThemedText type="small">{item.content}</ThemedText> : null}
            {item.image_url && (
              <Image
                source={{ uri: item.image_url }}
                style={styles.commentImage}
                contentFit="cover"
              />
            )}
            {user?.id === item.user_id && (
              <Pressable hitSlop={8} onPress={() => handleDeleteComment(item.id)}>
                <ThemedText type="small" themeColor="danger">
                  Excluir
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}
      />
      <View style={{ backgroundColor: theme.background }}>
        {attachment && (
          <View style={styles.attachmentPreview}>
            <Image
              source={{ uri: attachment.uri }}
              style={styles.attachmentImage}
              contentFit="cover"
            />
            <Pressable
              hitSlop={8}
              style={[styles.attachmentRemove, { backgroundColor: theme.backgroundElement }]}
              onPress={() => setAttachment(null)}>
              <Ionicons name="close" size={16} color={theme.text} />
            </Pressable>
          </View>
        )}
        <View style={styles.inputRow}>
          <Pressable
            hitSlop={8}
            style={[styles.attachButton, { backgroundColor: theme.backgroundElement }]}
            disabled={sending}
            onPress={handlePickImage}>
            <Ionicons name="image" size={20} color={theme.accent} />
          </Pressable>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            placeholder="Escreva um comentário…"
            placeholderTextColor={theme.textSecondary}
            value={newComment}
            onChangeText={setNewComment}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[
              styles.sendButton,
              { backgroundColor: theme.accent, opacity: sending ? 0.6 : 1 },
            ]}
            disabled={sending || (!newComment.trim() && !attachment)}
            onPress={handleSendComment}>
            {sending ? (
              <ActivityIndicator size="small" color={theme.accentText} />
            ) : (
              <Ionicons name="send" size={18} color={theme.accentText} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  still: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
  },
  ratingCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  commentsTitle: {
    fontSize: 16,
    marginTop: Spacing.two,
  },
  comment: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  commentImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    marginTop: Spacing.one,
  },
  attachmentPreview: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  attachmentImage: {
    width: 88,
    height: 88,
    borderRadius: 8,
  },
  attachmentRemove: {
    position: 'absolute',
    top: Spacing.one,
    right: -Spacing.one,
    borderRadius: 999,
    padding: 4,
  },
  attachButton: {
    borderRadius: 12,
    padding: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.two,
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    borderRadius: 12,
    padding: 12,
  },
});
