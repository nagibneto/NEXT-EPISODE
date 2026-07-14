import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  getFollowedShows,
  getWatchedCounts,
  getWatchedMovies,
  getWatchlistMovies,
  markEpisodeWatched,
  type FollowedShow,
  type WatchedMovie,
  type WatchlistMovie,
} from '@/lib/db';
import { airedEpisodeCount, getShowDetailsCached, posterUrl, stillUrl } from '@/lib/tmdb';
import { getNextUnwatchedEpisode, type NextEpisode } from '@/lib/watch-next';
import { registerPushToken, syncEpisodeNotifications } from '@/lib/notifications';

type LibraryMode = 'tv' | 'movie';

/** Última renderização da watchlist, salva para o app abrir instantâneo. */
interface HomeCache {
  shows?: FollowedShow[];
  watchedById?: Record<number, number>;
  airedById?: Record<number, number | null>;
  nextEpById?: Record<number, NextEpisode | null>;
}

const homeCacheKey = (userId: string) => `home-cache-v1:${userId}`;
type ShowStatusFilter = 'ongoing' | 'ended' | null;
type MovieStatusFilter = 'watched' | 'towatch' | null;
type ViewMode = 'grid' | 'list';
type SortMode = 'recent' | 'alpha';

/** Compara ignorando maiúsculas e acentos ("josé" casa com "Jose"). */
function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Botão de ícone das ferramentas de visualização/ordenação. */
function ToolButton({
  icon,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[styles.toolButton, active && { backgroundColor: theme.backgroundElement }]}
      onPress={onPress}>
      <Ionicons name={icon} size={16} color={active ? theme.accent : theme.textSecondary} />
    </Pressable>
  );
}

/** Linha do modo lista de filmes: pôster pequeno + nome, levando à tela do título. */
function LibraryListRow({
  tmdbId,
  name,
  posterPath,
}: {
  tmdbId: number;
  name: string;
  posterPath: string | null;
}) {
  const theme = useTheme();
  const uri = posterUrl(posterPath, 'w185');
  return (
    <Link href={{ pathname: '/movie/[id]', params: { id: String(tmdbId) } }} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.listRow, { backgroundColor: theme.backgroundElement }])}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.listPoster}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(tmdbId)}
          />
        ) : (
          <View style={[styles.listPoster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.listName}>
          {name}
        </ThemedText>
      </Pressable>
    </Link>
  );
}

/**
 * Linha "assistir a seguir" (estilo TV Time): imagem do episódio, nome da
 * série, próximo episódio não visto e botão para marcá-lo como assistido.
 */
function WatchNextRow({
  show,
  next,
  remainingAfter,
  onMarkWatched,
}: {
  show: FollowedShow;
  /** undefined = calculando; null = em dia. */
  next: NextEpisode | null | undefined;
  /** Episódios exibidos que ainda faltam depois deste. */
  remainingAfter: number;
  onMarkWatched: () => void;
}) {
  const theme = useTheme();
  const swipeRef = useRef<SwipeableMethods>(null);
  const image =
    (next?.stillPath ? stillUrl(next.stillPath) : null) ?? posterUrl(show.poster_path, 'w185');

  function confirmMarkWatched() {
    if (!next) return;
    Alert.alert(
      'Marcar como assistido',
      `${show.name} — T${String(next.seasonNumber).padStart(2, '0')} | E${String(
        next.episodeNumber
      ).padStart(2, '0')}${next.name ? ` (${next.name})` : ''}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Assisti', onPress: onMarkWatched },
      ]
    );
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!!next}
      friction={2}
      rightThreshold={72}
      overshootRight={false}
      // Arrastar a linha toda da direita para a esquerda marca direto, sem
      // modal. Só existe ação do lado direito, então qualquer abertura conta
      // (o `direction` reportado varia entre plataformas — não dá pra filtrar).
      onSwipeableOpen={() => {
        swipeRef.current?.close();
        onMarkWatched();
      }}
      renderRightActions={() => (
        // Pressable de reserva: se o gesto parar no meio, tocar no painel marca.
        <Pressable
          style={[styles.swipeAction, { backgroundColor: theme.accent }]}
          onPress={() => {
            swipeRef.current?.close();
            onMarkWatched();
          }}>
          <Ionicons name="checkmark" size={26} color={theme.accentText} />
        </Pressable>
      )}>
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_id) } }} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.nextRow, { backgroundColor: theme.backgroundElement }])}>
        {image ? (
          <Image
            source={{ uri: image }}
            style={styles.nextStill}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(show.tmdb_id)}
          />
        ) : (
          <View style={[styles.nextStill, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.nextInfo}>
          <View style={styles.nextShowName}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={{ color: theme.accent, flexShrink: 1 }}>
              {show.name}
            </ThemedText>
            <Ionicons name="chevron-forward" size={12} color={theme.accent} />
          </View>
          {next ? (
            <>
              <View style={styles.nextEpisodeRow}>
                <ThemedText type="smallBold">
                  T{String(next.seasonNumber).padStart(2, '0')} | E
                  {String(next.episodeNumber).padStart(2, '0')}
                </ThemedText>
                {remainingAfter > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.nextRemaining}>
                    +{remainingAfter}
                  </ThemedText>
                )}
              </View>
              {next.name ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {next.name}
                </ThemedText>
              ) : null}
            </>
          ) : next === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Você está em dia 🎉
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              …
            </ThemedText>
          )}
        </View>
        {next ? (
          <Pressable style={styles.nextCheck} hitSlop={10} onPress={confirmMarkWatched}>
            <Ionicons name="checkmark-circle-outline" size={26} color={theme.textSecondary} />
          </Pressable>
        ) : next === null ? (
          <View style={styles.nextCheck}>
            <Ionicons name="checkmark-circle" size={26} color={theme.accent} />
          </View>
        ) : (
          <View style={styles.nextCheck}>
            <ActivityIndicator size="small" />
          </View>
        )}
      </Pressable>
    </Link>
    </ReanimatedSwipeable>
  );
}

export default function MyShowsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<LibraryMode>('tv');
  const [query, setQuery] = useState('');
  // Padrões: filtro "Em andamento" ativo e visualização em lista — quem abre a
  // watchlist normalmente quer ver o que tem para assistir a seguir.
  const [statusFilter, setStatusFilter] = useState<ShowStatusFilter>('ongoing');
  const [movieFilter, setMovieFilter] = useState<MovieStatusFilter>(null);
  // Visualização separada por aba: séries em lista (assistir a seguir) e
  // filmes em blocos (grade de pôsteres) por padrão.
  const [tvViewMode, setTvViewMode] = useState<ViewMode>('list');
  const [movieViewMode, setMovieViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [shows, setShows] = useState<FollowedShow[] | null>(null);
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);
  const [movieWatchlist, setMovieWatchlist] = useState<WatchlistMovie[] | null>(null);
  // tmdb_id → episódios já exibidos segundo a TMDB (null = não deu para calcular).
  const [airedById, setAiredById] = useState<Record<number, number | null>>({});
  // tmdb_id → episódios que o usuário assistiu.
  const [watchedById, setWatchedById] = useState<Record<number, number>>({});
  // tmdb_id → próximo episódio a assistir (null = em dia; ausente = calculando).
  const [nextEpById, setNextEpById] = useState<Record<number, NextEpisode | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O cache salvo já foi lido? Antes disso os efeitos de TMDB não rodam, para
  // a tela abrir com os dados da sessão anterior e só então revalidar.
  const [hydrated, setHydrated] = useState(false);
  // Séries já revalidadas na TMDB nesta sessão: valores vindos do cache são
  // exibidos na hora, mas recalculados uma vez em segundo plano.
  const airedFresh = useRef(new Set<number>());
  const nextEpFresh = useRef(new Set<number>());
  // Buscas em andamento — impede chamadas duplicadas quando o efeito
  // re-executa no meio de um lote (as buscas nunca são canceladas).
  const airedPending = useRef(new Set<number>());
  const nextEpPending = useRef(new Set<number>());
  // Conta logada no momento; lotes disparados antes de trocar de conta
  // comparam com isso para descartar resultados da conta anterior.
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const [showsData, moviesData, watchlistData, counts] = await Promise.all([
        getFollowedShows(user.id),
        getWatchedMovies(user.id),
        getWatchlistMovies(user.id),
        getWatchedCounts(),
      ]);
      setShows(showsData);
      setMovies(moviesData);
      setMovieWatchlist(watchlistData);
      setWatchedById((prev) => {
        const next = Object.fromEntries(
          counts.map((count) => [count.tmdb_show_id, count.episode_count])
        );
        // Contagem mudou fora desta tela (ex.: tela da temporada)? O "assistir
        // a seguir" guardado ficou para trás — recalcula em segundo plano.
        for (const [id, count] of Object.entries(next)) {
          if (prev[Number(id)] !== undefined && prev[Number(id)] !== count) {
            nextEpFresh.current.delete(Number(id));
            airedFresh.current.delete(Number(id));
          }
        }
        return next;
      });
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

  // Hidrata a tela com o cache da sessão anterior: a lista aparece completa de
  // imediato e a revalidação (Supabase + TMDB) acontece por baixo, sem piscar.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    airedFresh.current = new Set();
    nextEpFresh.current = new Set();
    airedPending.current = new Set();
    nextEpPending.current = new Set();
    AsyncStorage.getItem(homeCacheKey(user.id))
      .then((raw) => {
        if (cancelled || !raw) return;
        const cached = JSON.parse(raw) as HomeCache;
        // Dados frescos que já chegaram têm prioridade sobre o cache.
        setShows((prev) => prev ?? cached.shows ?? null);
        setWatchedById((prev) =>
          Object.keys(prev).length ? prev : (cached.watchedById ?? {})
        );
        setAiredById((prev) => ({ ...cached.airedById, ...prev }));
        setNextEpById((prev) => ({ ...cached.nextEpById, ...prev }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Salva o estado atual para a próxima abertura do app. Com debounce: durante
  // a revalidação chegam vários lotes seguidos, e serializar a watchlist toda
  // a cada um deixaria a interface engasgada.
  useEffect(() => {
    if (!user || !hydrated || !shows) return;
    const userId = user.id;
    const timer = setTimeout(() => {
      const cache: HomeCache = { shows, watchedById, airedById, nextEpById };
      AsyncStorage.setItem(homeCacheKey(userId), JSON.stringify(cache)).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [user, hydrated, shows, watchedById, airedById, nextEpById]);

  // Busca na TMDB quantos episódios de cada série já foram ao ar — usado no
  // filtro Em andamento/Finalizadas e na barrinha de progresso dos cards.
  useEffect(() => {
    if (!shows || !hydrated) return;
    const missing = shows.filter(
      (show) =>
        !airedFresh.current.has(show.tmdb_id) && !airedPending.current.has(show.tmdb_id)
    );
    if (missing.length === 0) return;
    for (const show of missing) airedPending.current.add(show.tmdb_id);
    (async () => {
      try {
        const entries = await Promise.all(
          missing.map(async (show) => {
            try {
              const details = await getShowDetailsCached(show.tmdb_id);
              return [show.tmdb_id, airedEpisodeCount(details)] as const;
            } catch {
              return [show.tmdb_id, null] as const;
            }
          })
        );
        for (const [id] of entries) airedFresh.current.add(id);
        setAiredById((prev) => {
          const next = { ...prev };
          for (const [id, aired] of entries) {
            next[id] = aired;
          }
          return next;
        });
      } finally {
        for (const show of missing) airedPending.current.delete(show.tmdb_id);
      }
    })();
  }, [shows, hydrated, airedById]);

  // Calcula o "assistir a seguir" de cada série quando o modo lista está
  // ativo, em lotes para não estourar a TMDB de uma vez.
  useEffect(() => {
    if (!user || !shows || !hydrated || tvViewMode !== 'list' || mode !== 'tv') return;
    const userId = user.id;
    const missing = shows.filter(
      (show) =>
        !nextEpFresh.current.has(show.tmdb_id) && !nextEpPending.current.has(show.tmdb_id)
    );
    if (missing.length === 0) return;
    for (const show of missing) nextEpPending.current.add(show.tmdb_id);
    (async () => {
      try {
        for (let i = 0; i < missing.length; i += 6) {
          const batch = missing.slice(i, i + 6);
          const entries = await Promise.all(
            batch.map(async (show) => {
              try {
                return [show.tmdb_id, await getNextUnwatchedEpisode(userId, show.tmdb_id)] as const;
              } catch {
                return [show.tmdb_id, null] as const;
              }
            })
          );
          // Trocou de conta no meio? Descarta o que veio da conta anterior.
          if (userIdRef.current !== userId) return;
          for (const [id] of entries) nextEpFresh.current.add(id);
          setNextEpById((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } finally {
        for (const show of missing) nextEpPending.current.delete(show.tmdb_id);
      }
    })();
  }, [user, shows, hydrated, tvViewMode, mode, nextEpById]);

  async function handleRefresh() {
    setRefreshing(true);
    // Puxar para atualizar força a revalidação completa na TMDB.
    airedFresh.current.clear();
    nextEpFresh.current.clear();
    await load();
    setRefreshing(false);
  }

  /** Marca o "assistir a seguir" como visto e recalcula o próximo da série. */
  async function markNextWatched(showId: number) {
    if (!user) return;
    const next = nextEpById[showId];
    if (!next) return;
    try {
      await markEpisodeWatched(user.id, showId, next.seasonNumber, next.episodeNumber, true);
      setWatchedById((prev) => ({ ...prev, [showId]: (prev[showId] ?? 0) + 1 }));
      // Remove a entrada: o efeito acima detecta e busca o próximo episódio.
      nextEpFresh.current.delete(showId);
      setNextEpById((prev) => {
        const { [showId]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível marcar como assistido.');
    }
  }

  const trimmedQuery = normalize(query.trim());

  // Progresso na série: episódios assistidos ÷ já exibidos (0–1).
  // undefined enquanto a TMDB não respondeu ou quando não deu para calcular.
  const progressFor = useCallback(
    (tmdbId: number): number | undefined => {
      const aired = airedById[tmdbId];
      if (!aired) return undefined;
      return Math.min((watchedById[tmdbId] ?? 0) / aired, 1);
    },
    [airedById, watchedById]
  );

  // A ordem vinda do banco já é dos mais novos primeiro (data de seguir/assistir).
  const filteredShows = useMemo(() => {
    let list = shows ?? [];
    if (trimmedQuery) {
      list = list.filter((show) => normalize(show.name).includes(trimmedQuery));
    }
    if (statusFilter) {
      // "Finalizadas" = você já assistiu tudo que foi ao ar; "Em andamento" =
      // ainda tem episódio exibido por assistir (independe de a série ter
      // sido cancelada ou continuar no ar). Séries com progresso ainda não
      // calculado entram em "Em andamento" para a lista não abrir vazia.
      list = list.filter((show) => {
        const progress = progressFor(show.tmdb_id);
        if (statusFilter === 'ended') return progress !== undefined && progress >= 1;
        return progress === undefined || progress < 1;
      });
    }
    if (sortMode === 'alpha') {
      list = [...list].sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
      );
    }
    return list;
  }, [shows, trimmedQuery, statusFilter, progressFor, sortMode]);

  // Assistidos + Para assistir juntos (ou só um deles, conforme o filtro).
  const filteredMovies = useMemo(() => {
    const watched = (movies ?? []).map((movie) => ({
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      poster_path: movie.poster_path,
      date: movie.watched_at,
    }));
    const toWatch = (movieWatchlist ?? []).map((movie) => ({
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      poster_path: movie.poster_path,
      date: movie.added_at,
    }));
    let list;
    if (movieFilter === 'watched') {
      list = watched;
    } else if (movieFilter === 'towatch') {
      list = toWatch;
    } else {
      // Marcar como assistido remove da watchlist, mas dados antigos podem
      // ter o filme nos dois lugares — o assistido vence.
      const watchedIds = new Set(watched.map((movie) => movie.tmdb_id));
      list = [...watched, ...toWatch.filter((movie) => !watchedIds.has(movie.tmdb_id))];
    }
    if (trimmedQuery) {
      list = list.filter((movie) => normalize(movie.title).includes(trimmedQuery));
    }
    list = [...list].sort((a, b) =>
      sortMode === 'alpha'
        ? a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' })
        : b.date.localeCompare(a.date)
    );
    return list;
  }, [movies, movieWatchlist, movieFilter, trimmedQuery, sortMode]);

  if (shows === null && !error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const showingMovies = mode === 'movie';
  const viewMode = showingMovies ? movieViewMode : tvViewMode;
  const setViewMode = showingMovies ? setMovieViewMode : setTvViewMode;
  // Com filtro ativo mostramos "nada encontrado", mas se a pessoa não tem
  // título nenhum o convite para buscar é mais útil (o filtro vem ligado por
  // padrão e não pode esconder o estado de watchlist vazia).
  const filtering =
    (!!trimmedQuery || (showingMovies ? movieFilter !== null : statusFilter !== null)) &&
    (showingMovies
      ? (movies ?? []).length + (movieWatchlist ?? []).length > 0
      : (shows ?? []).length > 0);

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
                mode === option.value && { backgroundColor: theme.gold },
              ]}
              onPress={() => setMode(option.value)}>
              <ThemedText
                type="smallBold"
                style={{
                  // Texto escuro fixo: o amarelo é igual nos dois temas.
                  color: mode === option.value ? '#231A00' : theme.textSecondary,
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
      <View style={styles.toolsRow}>
        {showingMovies
          ? (
              [
                { value: 'watched', label: 'Assistidos' },
                { value: 'towatch', label: 'Para assistir' },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      movieFilter === option.value ? theme.accent : theme.backgroundElement,
                  },
                ]}
                onPress={() =>
                  setMovieFilter(movieFilter === option.value ? null : option.value)
                }>
                <ThemedText
                  type="small"
                  style={{
                    color: movieFilter === option.value ? theme.accentText : theme.text,
                  }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            ))
          : (
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
        <View style={styles.toolsSpacer} />
        <ToolButton
          icon="grid"
          active={viewMode === 'grid'}
          onPress={() => setViewMode('grid')}
        />
        <ToolButton
          icon="list"
          active={viewMode === 'list'}
          onPress={() => setViewMode('list')}
        />
        <View style={[styles.toolsDivider, { backgroundColor: theme.backgroundElement }]} />
        <ToolButton
          icon="text"
          active={sortMode === 'alpha'}
          onPress={() => setSortMode('alpha')}
        />
        <ToolButton
          icon="time"
          active={sortMode === 'recent'}
          onPress={() => setSortMode('recent')}
        />
      </View>
      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      ) : showingMovies ? (
        <FlatList
          key={`movie-${viewMode}`}
          data={filteredMovies}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={viewMode === 'grid' ? 3 : 1}
          // No Android o recorte de views fora da tela faz as imagens sumirem
          // durante o scroll; a lista é curta o bastante para mantê-las vivas.
          removeClippedSubviews={false}
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
          renderItem={({ item }) =>
            viewMode === 'grid' ? (
              <ShowCard
                tmdbId={item.tmdb_id}
                name={item.title}
                posterPath={item.poster_path}
                media="movie"
              />
            ) : (
              <LibraryListRow
                tmdbId={item.tmdb_id}
                name={item.title}
                posterPath={item.poster_path}
              />
            )
          }
        />
      ) : (
        <FlatList
          key={`tv-${viewMode}`}
          data={filteredShows}
          keyExtractor={(item) => String(item.tmdb_id)}
          numColumns={viewMode === 'grid' ? 3 : 1}
          // No Android o recorte de views fora da tela faz as imagens sumirem
          // durante o scroll; a lista é curta o bastante para mantê-las vivas.
          removeClippedSubviews={false}
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
          renderItem={({ item }) => {
            if (viewMode === 'grid') {
              return (
                <ShowCard
                  tmdbId={item.tmdb_id}
                  name={item.name}
                  posterPath={item.poster_path}
                  progress={progressFor(item.tmdb_id)}
                />
              );
            }
            const aired = airedById[item.tmdb_id] ?? 0;
            const watched = watchedById[item.tmdb_id] ?? 0;
            return (
              <WatchNextRow
                show={item}
                next={nextEpById[item.tmdb_id]}
                remainingAfter={Math.max(aired - watched - 1, 0)}
                onMarkWatched={() => markNextWatched(item.tmdb_id)}
              />
            );
          }}
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
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
  },
  toolsSpacer: {
    flex: 1,
  },
  toolsDivider: {
    width: 1,
    height: 20,
  },
  toolButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 6,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    marginHorizontal: Spacing.one,
    marginBottom: Spacing.one,
  },
  listPoster: {
    width: 24,
    height: 36,
    borderRadius: 4,
  },
  listName: {
    flex: 1,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    padding: Spacing.two,
    marginHorizontal: Spacing.one,
    marginBottom: Spacing.two,
  },
  nextStill: {
    width: 96,
    height: 60,
    borderRadius: 8,
  },
  nextInfo: {
    flex: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  nextShowName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: '100%',
  },
  nextEpisodeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
  nextRemaining: {
    fontSize: 12,
  },
  nextCheck: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeAction: {
    width: 88,
    borderRadius: 12,
    marginBottom: Spacing.two,
    marginRight: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
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
