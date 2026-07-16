import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage, getFollowedShows, getWatchedCounts, type FollowedShow } from '@/lib/db';
import { airedEpisodeCount, getShowDetailsCached, posterUrl } from '@/lib/tmdb';

interface NewEpisodesItem {
  show: FollowedShow;
  /** Episódios já exibidos e ainda não assistidos. */
  newCount: number;
  /** Total de episódios exibidos no momento — usado para lembrar o que já foi limpo. */
  aired: number;
}

/** tmdb_id → quantidade de episódios exibidos na última vez que a notificação foi limpa. */
type DismissedMap = Record<number, number>;

const dismissedKey = (userId: string) => `notifications-dismissed-v1:${userId}`;

/** Linha de uma série com episódios novos: leva à tela da série, ou dispensa com o X. */
function NotificationRow({
  show,
  newCount,
  onDismiss,
}: {
  show: FollowedShow;
  newCount: number;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const uri = posterUrl(show.poster_path, 'w185');
  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_id) } }} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.poster}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(show.tmdb_id)}
          />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.info}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {show.name}
          </ThemedText>
          <ThemedText type="small" themeColor="accent">
            {newCount === 1 ? '1 episódio novo' : `${newCount} episódios novos`}
          </ThemedText>
        </View>
        <Pressable hitSlop={8} onPress={onDismiss}>
          <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
        </Pressable>
      </Pressable>
    </Link>
  );
}

/** Séries seguidas com episódios já exibidos que o usuário ainda não assistiu. */
export default function NotificationsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [items, setItems] = useState<NewEpisodesItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setError(null);
      (async () => {
        try {
          const [shows, counts, dismissedRaw] = await Promise.all([
            getFollowedShows(user.id),
            getWatchedCounts(),
            AsyncStorage.getItem(dismissedKey(user.id)),
          ]);
          const dismissed: DismissedMap = dismissedRaw ? JSON.parse(dismissedRaw) : {};
          const watchedById = Object.fromEntries(
            counts.map((count) => [count.tmdb_show_id, count.episode_count])
          );
          const withNewCount = await Promise.all(
            shows.map(async (show) => {
              try {
                const details = await getShowDetailsCached(show.tmdb_id);
                const aired = airedEpisodeCount(details) ?? 0;
                const watched = watchedById[show.tmdb_id] ?? 0;
                return { show, newCount: Math.max(aired - watched, 0), aired };
              } catch {
                return { show, newCount: 0, aired: 0 };
              }
            })
          );
          if (cancelled) return;
          setItems(
            withNewCount
              // Já limpa nesta contagem de episódios exibidos? Só volta a aparecer
              // quando sair mais um episódio (aired sobe de novo).
              .filter((item) => item.newCount > 0 && dismissed[item.show.tmdb_id] !== item.aired)
              .sort((a, b) => b.newCount - a.newCount)
          );
        } catch (err) {
          if (!cancelled) setError(errorMessage(err, 'Erro ao carregar novidades.'));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  async function persistDismissed(entries: [number, number][]) {
    if (!user) return;
    const raw = await AsyncStorage.getItem(dismissedKey(user.id));
    const dismissed: DismissedMap = raw ? JSON.parse(raw) : {};
    for (const [id, aired] of entries) dismissed[id] = aired;
    await AsyncStorage.setItem(dismissedKey(user.id), JSON.stringify(dismissed));
  }

  function dismissOne(item: NewEpisodesItem) {
    setItems((prev) => (prev ?? []).filter((i) => i.show.tmdb_id !== item.show.tmdb_id));
    persistDismissed([[item.show.tmdb_id, item.aired]]).catch(() => {});
  }

  function clearAll() {
    if (!items || items.length === 0) return;
    Alert.alert('Limpar notificações', 'Remover todas as novidades da lista?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: () => {
          const current = items;
          setItems([]);
          persistDismissed(current.map((item) => [item.show.tmdb_id, item.aired])).catch(() => {});
        },
      },
    ]);
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (items === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.show.tmdb_id)}
      contentContainerStyle={[styles.list, !items.length && styles.listEmpty]}
      style={{ backgroundColor: theme.background }}
      ListHeaderComponent={
        items.length > 0 ? (
          <Pressable style={styles.clearAllButton} hitSlop={8} onPress={clearAll}>
            <ThemedText type="small" themeColor="accent">
              Limpar tudo
            </ThemedText>
          </Pressable>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <ThemedText type="subtitle" style={styles.message}>
            Nenhuma novidade
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            Quando suas séries tiverem episódios novos para assistir, elas aparecem aqui.
          </ThemedText>
        </View>
      }
      renderItem={({ item }) => (
        <NotificationRow
          show={item.show}
          newCount={item.newCount}
          onDismiss={() => dismissOne(item)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  list: {
    padding: Spacing.two,
  },
  listEmpty: {
    flexGrow: 1,
  },
  clearAllButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: Spacing.one,
    marginBottom: Spacing.one,
  },
  poster: {
    width: 40,
    height: 60,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    gap: 2,
  },
});
