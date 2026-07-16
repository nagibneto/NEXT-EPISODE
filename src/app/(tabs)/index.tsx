import AsyncStorage from '@react-native-async-storage/async-storage';
import Entypo from '@expo/vector-icons/Entypo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { GenreFilterSheet } from '@/components/genre-filter-sheet';
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
import {
  airedEpisodeCount,
  getGenres,
  getMovieDetailsCached,
  getShowDetailsCached,
  posterUrl,
  stillUrl,
  type TmdbGenre,
} from '@/lib/tmdb';
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
type ShowStatusFilter = 'notstarted' | 'ongoing' | 'ended' | null;
type MovieStatusFilter = 'watched' | 'towatch' | null;
type ViewMode = 'grid' | 'list';
type SortMode = 'recent' | 'alpha';

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Última atualização',
  alpha: 'Ordem alfabética',
};

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
  progress,
  onMarkWatched,
}: {
  show: FollowedShow;
  /** undefined = calculando; null = em dia. */
  next: NextEpisode | null | undefined;
  /** Episódios exibidos que ainda faltam depois deste. */
  remainingAfter: number;
  /** Andamento na série (0–1, episódios assistidos ÷ exibidos); indefinido = sem barra. */
  progress: number | undefined;
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
                  <ThemedText type="small" style={[styles.nextRemaining, { color: theme.gold }]}>
                    +{remainingAfter} episódio{remainingAfter > 1 ? 's' : ''}
                  </ThemedText>
                )}
              </View>
              {next.name ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {next.name}
                </ThemedText>
              ) : null}
              {progress !== undefined && (
                <View style={styles.nextProgressRow}>
                  <View
                    style={[styles.nextProgressTrack, { backgroundColor: theme.backgroundSelected }]}>
                    <View
                      style={[
                        styles.nextProgressFill,
                        { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
                      ]}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.nextProgressLabel}>
                    {Math.round(progress * 100)}%
                  </ThemedText>
                </View>
              )}
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
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // Posição (medida na tela) onde o menu de ordenação deve abrir, logo abaixo
  // do botão que o aciona — sem isso o Modal ocuparia a largura toda.
  const [sortMenuPos, setSortMenuPos] = useState<{ top: number; left: number } | null>(null);
  const sortButtonRef = useRef<View>(null);
  // Categoria/gênero TMDB selecionada para filtrar a watchlist (null = todas).
  const [genreFilter, setGenreFilter] = useState<number | null>(null);
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [shows, setShows] = useState<FollowedShow[] | null>(null);
  const [movies, setMovies] = useState<WatchedMovie[] | null>(null);
  const [movieWatchlist, setMovieWatchlist] = useState<WatchlistMovie[] | null>(null);
  // tmdb_id → episódios já exibidos segundo a TMDB (null = não deu para calcular).
  const [airedById, setAiredById] = useState<Record<number, number | null>>({});
  // tmdb_id → episódios que o usuário assistiu.
  const [watchedById, setWatchedById] = useState<Record<number, number>>({});
  // tmdb_id → próximo episódio a assistir (null = em dia; ausente = calculando).
  const [nextEpById, setNextEpById] = useState<Record<number, NextEpisode | null>>({});
  // tmdb_id → ids dos gêneros TMDB, usado pelo filtro de categoria.
  const [showGenresById, setShowGenresById] = useState<Record<number, number[]>>({});
  const [movieGenresById, setMovieGenresById] = useState<Record<number, number[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O cache salvo já foi lido? Antes disso os efeitos de TMDB não rodam, para
  // a tela abrir com os dados da sessão anterior e só então revalidar.
  const [hydrated, setHydrated] = useState(false);
  // Séries já revalidadas na TMDB nesta sessão: valores vindos do cache são
  // exibidos na hora, mas recalculados uma vez em segundo plano.
  const airedFresh = useRef(new Set<number>());
  const nextEpFresh = useRef(new Set<number>());
  const movieGenresFresh = useRef(new Set<number>());
  // Buscas em andamento — impede chamadas duplicadas quando o efeito
  // re-executa no meio de um lote (as buscas nunca são canceladas).
  const airedPending = useRef(new Set<number>());
  const nextEpPending = useRef(new Set<number>());
  const movieGenresPending = useRef(new Set<number>());
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

  // Categorias mudam de id entre séries e filmes na TMDB — recarrega a lista
  // de gêneros e limpa o filtro selecionado ao trocar de aba.
  useEffect(() => {
    setGenreFilter(null);
    getGenres(mode)
      .then(setGenres)
      .catch(() => setGenres([]));
  }, [mode]);

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
  // Os gêneros vêm de graça na mesma resposta e alimentam o filtro de categoria.
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
              return [show.tmdb_id, airedEpisodeCount(details), details.genres.map((g) => g.id)] as const;
            } catch {
              return [show.tmdb_id, null, [] as number[]] as const;
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
        setShowGenresById((prev) => {
          const next = { ...prev };
          for (const [id, , genreIds] of entries) {
            next[id] = genreIds;
          }
          return next;
        });
      } finally {
        for (const show of missing) airedPending.current.delete(show.tmdb_id);
      }
    })();
  }, [shows, hydrated, airedById]);

  // Busca os gêneros de cada filme (assistido ou na watchlist) para o filtro
  // de categoria, em lotes — só quando a aba Filmes está ativa.
  useEffect(() => {
    if (!hydrated || mode !== 'movie') return;
    const ids = new Set<number>();
    for (const movie of movies ?? []) ids.add(movie.tmdb_id);
    for (const movie of movieWatchlist ?? []) ids.add(movie.tmdb_id);
    const missing = [...ids].filter(
      (id) => !movieGenresFresh.current.has(id) && !movieGenresPending.current.has(id)
    );
    if (missing.length === 0) return;
    for (const id of missing) movieGenresPending.current.add(id);
    (async () => {
      try {
        for (let i = 0; i < missing.length; i += 6) {
          const batch = missing.slice(i, i + 6);
          const entries = await Promise.all(
            batch.map(async (id) => {
              try {
                const details = await getMovieDetailsCached(id);
                return [id, details.genres.map((g) => g.id)] as const;
              } catch {
                return [id, []] as const;
              }
            })
          );
          for (const [id] of entries) movieGenresFresh.current.add(id);
          setMovieGenresById((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } finally {
        for (const id of missing) movieGenresPending.current.delete(id);
      }
    })();
  }, [hydrated, mode, movies, movieWatchlist]);

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

  /** Abre o menu de ordenação ancorado logo abaixo do botão que o acionou. */
  function openSortMenu() {
    sortButtonRef.current?.measureInWindow((x, y, _width, height) => {
      setSortMenuPos({ top: y + height + 4, left: x });
    });
    setSortMenuOpen(true);
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
    if (genreFilter !== null) {
      list = list.filter((show) => (showGenresById[show.tmdb_id] ?? []).includes(genreFilter));
    }
    if (statusFilter) {
      // "Finalizadas" = você já assistiu tudo que foi ao ar; "Não iniciado" =
      // nenhum episódio assistido ainda; "Em andamento" = já começou mas
      // ainda tem episódio exibido por assistir. Séries com progresso ainda
      // não calculado entram em "Em andamento" para a lista não abrir vazia.
      list = list.filter((show) => {
        const progress = progressFor(show.tmdb_id);
        const watched = watchedById[show.tmdb_id] ?? 0;
        if (statusFilter === 'ended') return progress !== undefined && progress >= 1;
        if (statusFilter === 'notstarted') {
          return progress !== undefined && progress < 1 && watched === 0;
        }
        return progress === undefined || (progress < 1 && watched > 0);
      });
    }
    if (sortMode === 'alpha') {
      list = [...list].sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
      );
    }
    return list;
  }, [
    shows,
    trimmedQuery,
    genreFilter,
    showGenresById,
    statusFilter,
    progressFor,
    watchedById,
    sortMode,
  ]);

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
    if (genreFilter !== null) {
      list = list.filter((movie) => (movieGenresById[movie.tmdb_id] ?? []).includes(genreFilter));
    }
    list = [...list].sort((a, b) =>
      sortMode === 'alpha'
        ? a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' })
        : b.date.localeCompare(a.date)
    );
    return list;
  }, [
    movies,
    movieWatchlist,
    movieFilter,
    trimmedQuery,
    genreFilter,
    movieGenresById,
    sortMode,
  ]);

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
    (!!trimmedQuery ||
      genreFilter !== null ||
      (showingMovies ? movieFilter !== null : statusFilter !== null)) &&
    (showingMovies
      ? (movies ?? []).length + (movieWatchlist ?? []).length > 0
      : (shows ?? []).length > 0);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.searchRow}>
        <View style={[styles.modeToggle, { backgroundColor: theme.backgroundElement }]}>
          <Pressable
            style={[styles.modeButtonWide, mode === 'tv' && { backgroundColor: theme.gold }]}
            onPress={() => setMode('tv')}>
            <Ionicons
              name="tv"
              size={14}
              // Ícone/texto escuro fixo: o amarelo é igual nos dois temas.
              color={mode === 'tv' ? '#231A00' : theme.textSecondary}
            />
            <ThemedText
              type="small"
              style={{ color: mode === 'tv' ? '#231A00' : theme.textSecondary }}>
              Séries
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeButtonWide, mode === 'movie' && { backgroundColor: theme.gold }]}
            onPress={() => setMode('movie')}>
            <Entypo
              name="clapperboard"
              size={14}
              color={mode === 'movie' ? '#231A00' : theme.textSecondary}
            />
            <ThemedText
              type="small"
              style={{ color: mode === 'movie' ? '#231A00' : theme.textSecondary }}>
              Filmes
            </ThemedText>
          </Pressable>
        </View>
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder={showingMovies ? 'Buscar filmes…' : 'Buscar séries…'}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>
      </View>
      <View style={[styles.statusSegmented, { backgroundColor: theme.backgroundElement }]}>
        {showingMovies
          ? (
              [
                { value: 'watched', label: 'Assistidos', icon: 'checkmark-circle' },
                { value: 'towatch', label: 'Para assistir', icon: 'bookmark' },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.statusSegment,
                  movieFilter === option.value && { backgroundColor: theme.accent },
                ]}
                onPress={() =>
                  setMovieFilter(movieFilter === option.value ? null : option.value)
                }>
                <Ionicons
                  name={option.icon}
                  size={13}
                  color={movieFilter === option.value ? theme.accentText : theme.textSecondary}
                />
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={[
                    styles.statusSegmentText,
                    { color: movieFilter === option.value ? theme.accentText : theme.textSecondary },
                  ]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            ))
          : (
              [
                { value: 'ongoing', label: 'Em andamento', icon: 'play-circle' },
                { value: 'notstarted', label: 'Não iniciado', icon: 'ellipse-outline' },
                { value: 'ended', label: 'Finalizadas', icon: 'checkmark-circle' },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.statusSegment,
                  statusFilter === option.value && { backgroundColor: theme.accent },
                ]}
                onPress={() =>
                  setStatusFilter(statusFilter === option.value ? null : option.value)
                }>
                <Ionicons
                  name={option.icon}
                  size={13}
                  color={statusFilter === option.value ? theme.accentText : theme.textSecondary}
                />
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={[
                    styles.statusSegmentText,
                    { color: statusFilter === option.value ? theme.accentText : theme.textSecondary },
                  ]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
      </View>
      <View style={styles.toolsRow}>
        {/* "Ordenar por" desativado por enquanto — suspeita é que ninguém vai
            usar; a ordenação padrão (mais recentes) continua valendo.
        <Pressable
          ref={sortButtonRef}
          style={[
            styles.sortButton,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: sortMenuOpen ? theme.accent : theme.backgroundSelected,
            },
          ]}
          onPress={openSortMenu}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.sortButtonText}>
            Ordenar por:{' '}
          </ThemedText>
          <ThemedText type="small" style={[styles.sortButtonText, { color: theme.accent }]}>
            {SORT_LABELS[sortMode]}
          </ThemedText>
          <Ionicons
            name="chevron-down"
            size={12}
            color={sortMenuOpen ? theme.accent : theme.textSecondary}
          />
        </Pressable>
        */}
        <Pressable
          style={[
            styles.sortButton,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: genreFilter !== null ? theme.accent : theme.backgroundSelected,
              gap: Spacing.one + 2,
            },
          ]}
          onPress={() => setGenreSheetOpen(true)}>
          <Ionicons
            name="filter"
            size={13}
            color={genreFilter !== null ? theme.accent : theme.textSecondary}
          />
          <ThemedText
            type="small"
            style={[
              styles.sortButtonText,
              { color: genreFilter !== null ? theme.accent : theme.text },
            ]}>
            Categorias
          </ThemedText>
        </Pressable>
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
      </View>
      <GenreFilterSheet
        visible={genreSheetOpen}
        genres={genres}
        selectedId={genreFilter}
        onSelect={setGenreFilter}
        onClose={() => setGenreSheetOpen(false)}
      />
      {/* Menu do "Ordenar por" — comentado junto com o botão que o abre.
      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortMenuOpen(false)}>
          {sortMenuPos && (
            <View
              style={[
                styles.sortMenu,
                {
                  backgroundColor: theme.backgroundElement,
                  top: sortMenuPos.top,
                  left: sortMenuPos.left,
                },
              ]}>
              {(
                [
                  { value: 'recent', label: 'Última atualização' },
                  { value: 'alpha', label: 'Ordem alfabética' },
                ] as const
              ).map((option) => (
                <Pressable
                  key={option.value}
                  style={styles.sortOption}
                  onPress={() => {
                    setSortMode(option.value);
                    setSortMenuOpen(false);
                  }}>
                  <ThemedText type="small" style={{ color: theme.text }}>
                    {option.label}
                  </ThemedText>
                  {sortMode === option.value && (
                    <Ionicons name="checkmark" size={14} color={theme.accent} />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Modal>
      */}
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
                progress={progressFor(item.tmdb_id)}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
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
    paddingVertical: 10,
    fontSize: 14,
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 2,
  },
  modeButtonWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 7,
  },
  statusSegmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  statusSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: Spacing.one,
    paddingVertical: 8,
  },
  statusSegmentText: {
    fontSize: 12,
    lineHeight: 16,
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
  toolButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
  sortButtonText: {
    fontSize: 12,
    lineHeight: 16,
  },
  sortMenu: {
    position: 'absolute',
    borderRadius: 10,
    paddingVertical: Spacing.one,
    minWidth: 170,
    elevation: 4,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
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
    gap: 2,
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
  nextProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: Spacing.one,
    marginTop: 0,
  },
  nextProgressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  nextProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  nextProgressLabel: {
    fontSize: 11,
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
