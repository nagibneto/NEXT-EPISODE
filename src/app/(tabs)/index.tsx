import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  getFollowedShows,
  getWatchedMovies,
  type FollowedShow,
  type WatchedMovie,
} from '@/lib/db';
import { registerPushToken, syncEpisodeNotifications } from '@/lib/notifications';

type LibraryMode = 'tv' | 'movie';

export default function MyShowsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<LibraryMode>('tv');
  const [shows, setShows] = useState<FollowedShow[] | null>(null);
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const [showsData, moviesData] = await Promise.all([
        getFollowedShows(user.id),
        getWatchedMovies(user.id),
      ]);
      setShows(showsData);
      setMovies(moviesData);
      // Reagenda notificações em segundo plano; falha não bloqueia a tela.
      syncEpisodeNotifications(user.id).catch(() => {});
      // Registra o push token para as notificações remotas (Edge Function).
      registerPushToken(user.id).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar sua lista.');
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (shows === null && !error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const showingMovies = mode === 'movie';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.modeRow}>
        {(
          [
            { value: 'tv', label: 'Séries' },
            { value: 'movie', label: 'Filmes' },
          ] as const
        ).map((option) => (
          <Pressable
            key={option.value}
            style={[
              styles.modeButton,
              {
                backgroundColor:
                  mode === option.value ? theme.accent : theme.backgroundElement,
              },
            ]}
            onPress={() => setMode(option.value)}>
            <ThemedText
              type="smallBold"
              style={{ color: mode === option.value ? theme.accentText : theme.text }}>
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      ) : showingMovies ? (
        <FlatList
          data={movies ?? []}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={3}
          contentContainerStyle={[styles.list, !(movies ?? []).length && styles.listEmpty]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.message}>
                Nenhum filme ainda
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Use a aba Buscar para encontrar os filmes que você já assistiu.
              </ThemedText>
              <Pressable
                style={[styles.searchButton, { backgroundColor: theme.accent }]}
                onPress={() => router.push('/search')}>
                <Ionicons name="search" size={18} color={theme.accentText} />
                <ThemedText type="smallBold" style={[styles.searchButtonLabel, { color: theme.accentText }]}>
                  Buscar filmes
                </ThemedText>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <ShowCard
              tmdbId={item.tmdb_id}
              name={item.title}
              posterPath={item.poster_path}
              media="movie"
            />
          )}
        />
      ) : (
        <FlatList
          data={shows}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={3}
          contentContainerStyle={[styles.list, !(shows ?? []).length && styles.listEmpty]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.message}>
                Nenhuma série ainda
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Use a aba Buscar para encontrar e seguir suas séries favoritas.
              </ThemedText>
              <Pressable
                style={[styles.searchButton, { backgroundColor: theme.accent }]}
                onPress={() => router.push('/search')}>
                <Ionicons name="search" size={18} color={theme.accentText} />
                <ThemedText type="smallBold" style={[styles.searchButtonLabel, { color: theme.accentText }]}>
                  Buscar séries
                </ThemedText>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <ShowCard tmdbId={item.tmdb_id} name={item.name} posterPath={item.poster_path} />
          )}
        />
      )}
    </View>
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
    gap: Spacing.two,
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  modeButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  list: {
    padding: Spacing.two,
  },
  // Faz o estado vazio ocupar a tela toda para o botão ficar no centro.
  listEmpty: {
    flexGrow: 1,
  },
  message: {
    textAlign: 'center',
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.five,
    paddingVertical: 14,
    marginTop: Spacing.three,
    elevation: 2,
  },
  searchButtonLabel: {
    fontSize: 16,
  },
});
