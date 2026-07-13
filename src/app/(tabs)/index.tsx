import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
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
import { getShowDetailsCached } from '@/lib/tmdb';
import { registerPushToken, syncEpisodeNotifications } from '@/lib/notifications';

type LibraryMode = 'tv' | 'movie';
type ShowStatusFilter = 'ongoing' | 'ended' | null;

/** Compara ignorando maiúsculas e acentos ("josé" casa com "Jose"). */
function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export default function MyShowsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<LibraryMode>('tv');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShowStatusFilter>(null);
  const [shows, setShows] = useState<FollowedShow[] | null>(null);
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);
  // tmdb_id → série já encerrada? (status "Ended"/"Canceled" na TMDB)
  const [endedById, setEndedById] = useState<Record<number, boolean>>({});
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

  // Busca o status de cada série na TMDB para o filtro Em andamento/Finalizadas.
  useEffect(() => {
    if (!shows) return;
    let cancelled = false;
    const missing = shows.filter((show) => endedById[show.tmdb_id] === undefined);
    if (missing.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (show) => {
          try {
            const details = await getShowDetailsCached(show.tmdb_id);
            return [show.tmdb_id, details.status === 'Ended' || details.status === 'Canceled'] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setEndedById((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [shows, endedById]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const trimmedQuery = normalize(query.trim());

  const filteredShows = useMemo(() => {
    let list = shows ?? [];
    if (trimmedQuery) {
      list = list.filter((show) => normalize(show.name).includes(trimmedQuery));
    }
    if (statusFilter) {
      list = list.filter((show) => {
        const ended = endedById[show.tmdb_id];
        if (ended === undefined) return false;
        return statusFilter === 'ended' ? ended : !ended;
      });
    }
    return list;
  }, [shows, trimmedQuery, statusFilter, endedById]);

  const filteredMovies = useMemo(() => {
    const list = movies ?? [];
    if (!trimmedQuery) return list;
    return list.filter((movie) => normalize(movie.title).includes(trimmedQuery));
  }, [movies, trimmedQuery]);

  if (shows === null && !error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const showingMovies = mode === 'movie';
  const filtering = !!trimmedQuery || (!showingMovies && statusFilter !== null);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.topRow}>
        <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
          {(
            [
              { value: 'tv', label: 'Séries' },
              { value: 'movie', label: 'Filmes' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.segment,
                mode === option.value && { backgroundColor: theme.accent },
              ]}
              onPress={() => setMode(option.value)}>
              <ThemedText
                type="smallBold"
                style={{
                  color: mode === option.value ? theme.accentText : theme.textSecondary,
                }}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder="Buscar…"
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>
      </View>
      {!showingMovies && (
        <View style={styles.statusRow}>
          {(
            [
              { value: 'ongoing', label: 'Em andamento' },
              { value: 'ended', label: 'Finalizadas' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.chip,
                {
                  backgroundColor:
                    statusFilter === option.value ? theme.accent : theme.backgroundElement,
                },
              ]}
              onPress={() =>
                setStatusFilter(statusFilter === option.value ? null : option.value)
              }>
              <ThemedText
                type="small"
                style={{
                  color: statusFilter === option.value ? theme.accentText : theme.text,
                }}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      ) : showingMovies ? (
        <FlatList
          data={filteredMovies}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={3}
          contentContainerStyle={[styles.list, !filteredMovies.length && styles.listEmpty]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            filtering ? (
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Nenhum filme encontrado com esse filtro.
              </ThemedText>
            ) : (
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
            )
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
          data={filteredShows}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={3}
          contentContainerStyle={[styles.list, !filteredShows.length && styles.listEmpty]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            filtering ? (
              <ThemedText themeColor="textSecondary" style={styles.message}>
                Nenhuma série encontrada com esse filtro.
              </ThemedText>
            ) : (
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
            )
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 2,
  },
  segment: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
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
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.four,
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
