import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  addEpisodeComment,
  blockUser,
  deleteEpisodeComment,
  errorMessage,
  getEpisodeComments,
  likeComment,
  markCommentSpoiler,
  profileDisplayName,
  reportComment,
  unlikeComment,
  type EpisodeComment,
  type MediaType,
} from '@/lib/db';
import { uploadCommentImage } from '@/lib/storage';

interface CommentsScreenProps {
  /** 'tv' para episódios, 'movie' para filmes (season/episode = 0). */
  mediaType: MediaType;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  /** Conteúdo acima dos comentários (detalhes do episódio/filme, nota etc.). */
  header: React.ReactElement;
  /** Comentários ficam cobertos até o usuário ter assistido (ou optar por ver). */
  watched: boolean | null;
  /** Texto do aviso quando os comentários estão bloqueados. */
  lockedText: string;
}

// Mais curtidos primeiro; empate resolvido pelos mais recentes.
function byLikesThenNewest(a: EpisodeComment, b: EpisodeComment) {
  return b.like_count - a.like_count || b.created_at.localeCompare(a.created_at);
}

/**
 * Tela de comentários compartilhada por episódios e filmes: lista com
 * respostas, curtidas, spoilers, anexos e campo de envio.
 */
export function CommentsScreen({
  mediaType,
  tmdbId,
  seasonNumber = 0,
  episodeNumber = 0,
  header,
  watched,
  lockedText,
}: CommentsScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Acompanha o teclado pelos insets nativos (funciona com edge-to-edge, onde
  // a janela não é redimensionada e os eventos do Keyboard são pouco
  // confiáveis): aberto, a tela sobe a altura dele; fechado, sobra o respiro
  // da barra de navegação do sistema.
  const keyboard = useAnimatedKeyboard();
  const keyboardPadding = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));

  const listRef = useRef<FlatList<EpisodeComment>>(null);
  const [comments, setComments] = useState<EpisodeComment[] | null>(null);
  const [newComment, setNewComment] = useState('');
  const [attachment, setAttachment] = useState<{ uri: string; mimeType: string | null } | null>(
    null
  );
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<EpisodeComment | null>(null);
  // Comentário com o menu de ações (sheet) aberto.
  const [menuComment, setMenuComment] = useState<EpisodeComment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [commentsRevealed, setCommentsRevealed] = useState(false);
  const commentsUnlocked = watched === true || commentsRevealed;

  // Comentários de topo ordenados pelos mais curtidos; respostas agrupadas
  // pelo pai, em ordem cronológica (como numa conversa).
  const topLevelComments = useMemo(
    () => (comments ?? []).filter((c) => !c.parent_id).sort(byLikesThenNewest),
    [comments]
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, EpisodeComment[]>();
    for (const comment of comments ?? []) {
      if (!comment.parent_id) continue;
      const list = map.get(comment.parent_id) ?? [];
      list.push(comment);
      map.set(comment.parent_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [comments]);

  const loadComments = useCallback(async (): Promise<EpisodeComment[] | null> => {
    if (!user) return null;
    try {
      const list = await getEpisodeComments(tmdbId, seasonNumber, episodeNumber, user.id, mediaType);
      setComments(list);
      return list;
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível carregar os comentários.'));
      // Encerra o spinner; a lista aparece vazia com o erro visível acima.
      setComments([]);
      return null;
    }
  }, [tmdbId, seasonNumber, episodeNumber, user, mediaType]);

  // Só busca os comentários quando a seção é desbloqueada — evita transferir
  // conteúdo com spoiler antes do usuário optar por ver.
  useEffect(() => {
    if (commentsUnlocked) loadComments();
  }, [commentsUnlocked, loadComments]);

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

  /** Rola a lista até o comentário (ou até o pai da thread, no caso de resposta). */
  function scrollToComment(list: EpisodeComment[], targetId: string) {
    const index = list.filter((c) => !c.parent_id).sort(byLikesThenNewest)
      .findIndex((c) => c.id === targetId);
    if (index < 0) return;
    // Dá tempo da lista re-renderizar com os dados novos antes de rolar.
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }, 150);
  }

  async function handleSendComment() {
    if (!user || (!newComment.trim() && !attachment)) return;
    setSending(true);
    Keyboard.dismiss();
    try {
      let imageUrl: string | null = null;
      if (attachment) {
        imageUrl = await uploadCommentImage(user.id, attachment.uri, attachment.mimeType);
      }
      // Resposta de resposta vira resposta do mesmo pai (1 nível só).
      const parentId = replyTo ? (replyTo.parent_id ?? replyTo.id) : null;
      const newId = await addEpisodeComment(
        user.id,
        tmdbId,
        seasonNumber,
        episodeNumber,
        newComment.trim(),
        imageUrl,
        parentId,
        mediaType
      );
      setNewComment('');
      setAttachment(null);
      setReplyTo(null);
      const list = await loadComments();
      // Respostas ficam aninhadas na thread do pai — é até ele que se rola.
      if (list) scrollToComment(list, parentId ?? newId);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar o comentário.'));
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteEpisodeComment(commentId);
      await loadComments();
    } catch {
      // Mantém a lista como está se a exclusão falhar.
    }
  }

  async function handleToggleLike(comment: EpisodeComment) {
    if (!user) return;
    // Atualização otimista; a ordenação por curtidas é refeita no useMemo.
    setComments((prev) =>
      (prev ?? []).map((c) =>
        c.id === comment.id
          ? {
              ...c,
              liked_by_me: !c.liked_by_me,
              like_count: c.like_count + (c.liked_by_me ? -1 : 1),
            }
          : c
      )
    );
    try {
      if (comment.liked_by_me) await unlikeComment(comment.id, user.id);
      else await likeComment(comment.id, user.id);
    } catch {
      await loadComments();
    }
  }

  /**
   * Alerts logo após fechar um Modal disputam com a animação de dismiss no
   * iOS e podem nem aparecer — o atraso dá tempo do sheet sair da tela.
   */
  function alertAfterSheet(title: string, message?: string, buttons?: Parameters<typeof Alert.alert>[2]) {
    setTimeout(() => Alert.alert(title, message, buttons, { cancelable: true }), 400);
  }

  function handleSpoilerFlag(comment: EpisodeComment) {
    if (!user) return;
    markCommentSpoiler(comment.id, user.id).catch(() => {});
    alertAfterSheet(
      'Sinalização enviada',
      'Obrigado por avisar — com sinalizações suficientes o comentário será ocultado.'
    );
  }

  function handleReport(comment: EpisodeComment) {
    if (!user) return;
    reportComment(comment.id, user.id).catch(() => {});
    alertAfterSheet('Denúncia enviada', 'Obrigado por avisar — vamos revisar.');
  }

  function handleBlock(comment: EpisodeComment) {
    if (!user) return;
    alertAfterSheet(
      'Bloquear usuário',
      'Vocês deixam de ver o conteúdo um do outro e a amizade (se houver) é desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(user.id, comment.user_id);
              await loadComments();
            } catch {
              // Segue sem travar a tela se o bloqueio falhar.
            }
          },
        },
      ]
    );
  }

  function renderComment(item: EpisodeComment) {
    return (
      <View style={[styles.comment, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.commentHeader}>
          <View style={styles.commentAuthor}>
            <UserAvatar
              avatarId={item.profiles?.avatar_id}
              name={profileDisplayName(item.profiles)}
              size={28}
            />
            <ThemedText type="smallBold">{profileDisplayName(item.profiles)}</ThemedText>
          </View>
          <View style={styles.commentHeaderRight}>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(item.created_at).toLocaleDateString('pt-BR')}
            </ThemedText>
            {user?.id !== item.user_id && (
              <Pressable hitSlop={8} onPress={() => setMenuComment(item)}>
                <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
        {item.content ? <ThemedText type="small">{item.content}</ThemedText> : null}
        {item.image_url && (
          <Image source={{ uri: item.image_url }} style={styles.commentImage} contentFit="cover" />
        )}
        <View style={styles.commentFooter}>
          <View style={styles.commentActions}>
            <Pressable hitSlop={8} style={styles.likeButton} onPress={() => handleToggleLike(item)}>
              <Ionicons
                name={item.liked_by_me ? 'heart' : 'heart-outline'}
                size={16}
                color={item.liked_by_me ? theme.danger : theme.textSecondary}
              />
              {item.like_count > 0 && (
                <ThemedText type="small" themeColor={item.liked_by_me ? 'danger' : 'textSecondary'}>
                  {item.like_count}
                </ThemedText>
              )}
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setReplyTo(item)}>
              <ThemedText type="small" themeColor="textSecondary">
                Responder
              </ThemedText>
            </Pressable>
          </View>
          {user?.id === item.user_id && (
            <Pressable hitSlop={8} onPress={() => handleDeleteComment(item.id)}>
              <ThemedText type="small" themeColor="danger">
                Excluir
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.container, { backgroundColor: theme.background }, keyboardPadding]}>
      <FlatList
        ref={listRef}
        data={commentsUnlocked ? topLevelComments : []}
        keyExtractor={(item) => item.id}
        // Alvo ainda não medido (fora da janela renderizada): aproxima pela
        // média e tenta de novo quando os itens do trecho já tiverem altura.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
          }, 300);
        }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        // Arrastar a lista recolhe o teclado (no iOS, acompanha o dedo).
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        ListHeaderComponent={
          <View style={styles.header}>
            {header}

            {error && <ThemedText themeColor="danger">{error}</ThemedText>}

            {commentsUnlocked ? (
              <ThemedText type="smallBold" style={styles.commentsTitle}>
                Comentários {comments ? `(${comments.length})` : ''}
              </ThemedText>
            ) : (
              <View style={[styles.lockedCard, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="eye-off-outline" size={22} color={theme.textSecondary} />
                <ThemedText type="smallBold">Comentários bloqueados</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {lockedText}
                </ThemedText>
                <Pressable
                  style={[styles.revealButton, { backgroundColor: theme.accent }]}
                  onPress={() => setCommentsRevealed(true)}>
                  <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                    Mostrar comentários mesmo assim
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !commentsUnlocked ? null : comments === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.three }} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              Seja o primeiro a comentar!
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.commentThread}>
            {renderComment(item)}
            {(repliesByParent.get(item.id) ?? []).map((reply) => (
              <View key={reply.id} style={styles.replyIndent}>
                {renderComment(reply)}
              </View>
            ))}
          </View>
        )}
      />
      {commentsUnlocked && (
        <View style={{ backgroundColor: theme.background }}>
          {replyTo && (
            <View style={[styles.replyBanner, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                style={{ flex: 1 }}>
                Respondendo a {profileDisplayName(replyTo.profiles)}
              </ThemedText>
              <Pressable hitSlop={8} onPress={() => setReplyTo(null)}>
                <Ionicons name="close" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
          )}
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
      )}

      <ActionSheet
        visible={menuComment !== null}
        title={menuComment ? profileDisplayName(menuComment.profiles) : undefined}
        onClose={() => setMenuComment(null)}
        options={
          menuComment
            ? [
                {
                  label: 'Sinalizar como spoiler',
                  icon: 'eye-off-outline',
                  onPress: () => handleSpoilerFlag(menuComment),
                },
                {
                  label: 'Denunciar comentário',
                  icon: 'flag-outline',
                  onPress: () => handleReport(menuComment),
                },
                {
                  label: 'Bloquear usuário',
                  icon: 'ban-outline',
                  destructive: true,
                  onPress: () => handleBlock(menuComment),
                },
              ]
            : []
        }
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  commentHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  commentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.half,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  commentThread: {
    gap: Spacing.two,
  },
  lockedCard: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  revealButton: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    marginTop: Spacing.one,
  },
  replyIndent: {
    marginLeft: Spacing.four,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 8,
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
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 48,
    maxHeight: 120,
    // Centraliza o texto de uma linha na altura mínima (Android alinha no topo).
    textAlignVertical: 'center',
  },
  sendButton: {
    borderRadius: 12,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
