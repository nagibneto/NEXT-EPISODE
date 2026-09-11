import Entypo from '@expo/vector-icons/Entypo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetOption } from '@/components/action-sheet';
import { DiscoverFilterSheet, type YearRange } from '@/components/discover-filter-sheet';
import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import {
  addMovieToWatchlist,
  followShow,
  getFollowedShows,
  getWatchedMovies,
  getWatchlistMovies,
  removeMovieFromWatchlist,
  unfollowShow,
} from '@/lib/db';
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  discoverMovies,
  discoverShows,
  getGenres,
  getMovieNames,
  getPopularMovies,
  getPopularShows,
  getShowNames,
  getStreamingProviders,
  searchMovies,
  searchPeople,
  searchShows,
  type TmdbGenre,
  type TmdbMovieSummary,
  type TmdbShowSummary,
  type TmdbWatchProvider,
} from '@/lib/tmdb';

type SearchMode = 'tv' | 'movie';

interface SearchResult {
  id: number;
  name: string;
  poster_path: string | null;
  year?: string;
  /** Média do TMDB (0–10); 0 quando o título ainda não tem votos. */
  rating?: number;
  /** Preenchido quando o resultado veio de uma busca por ator, não pelo título. */
  viaActor?: string;
}

function fromShow(show: TmdbShowSummary): SearchResult {
  return {
    id: show.id,
    name: show.name,
    poster_path: show.poster_path,
    year: show.first_air_date ? show.first_air_date.slice(0, 4) : undefined,
    rating: show.vote_average,
  };
}

function fromMovie(movie: TmdbMovieSummary): SearchResult {
  return {
    id: movie.id,
    name: movie.title,
    poster_path: movie.poster_path,
    year: movie.release_date ? movie.release_date.slice(0, 4) : undefined,
    rating: movie.vote_average,
  };
}

/**
 * A busca da TMDB é por palavra: "mind hunter" não acha "Mindhunter" porque
 * o título é uma palavra só. Quando a query tem espaço, tenta de novo colada
 * ("mindhunter") e junta o que achar — só na primeira página, mesmo esquema
 * do searchByCast abaixo.
 */
async function searchJoined(
  query: string,
  media: SearchMode,
  seenIds: Set<number>
): Promise<SearchResult[]> {
  const joined = query.replace(/\s+/g, '');
  if (joined === query || joined.length < 3) return [];
  try {
    const extra: SearchResult[] = [];
    if (media === 'tv') {
      const { results } = await searchShows(joined);
      for (const item of results) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        extra.push(fromShow(item));
      }
    } else {
      const { results } = await searchMovies(joined);
      for (const item of results) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        extra.push(fromMovie(item));
      }
    }
    return extra;
  } catch {
    return [];
  }
}

/**
 * Quando a busca por título não é suficiente, procura por atores com esse
 * nome e junta os títulos em que eles são conhecidos — só na primeira
 * página, para não complicar a paginação.
 */
async function searchByCast(query: string, media: SearchMode, seenIds: Set<number>) {
  try {
    const { results } = await searchPeople(query);
    const extra: SearchResult[] = [];
    for (const person of results) {
      for (const item of person.known_for) {
        if (seenIds.has(item.id)) continue;
        if (media === 'tv' && item.media_type === 'tv') {
          seenIds.add(item.id);
          extra.push({ ...fromShow(item), viaActor: person.name });
        } else if (media === 'movie' && item.media_type === 'movie') {
          seenIds.add(item.id);
          extra.push({ ...fromMovie(item), viaActor: person.name });
        }
      }
    }
    return extra;
  } catch {
    return [];
  }
}

// Cada valor é o início de uma faixa de nota: 6 = "de 6 a 7" (9 = "de 9 a 10").
// O usuário pode marcar várias; o filtro final vai do menor ao maior + 1.
const RATING_BUCKETS = [5, 6, 7, 8, 9] as const;

/** Pílula da barra de filtros (Filtros / Nota / Streaming), estilo da imagem. */
function FilterPill({
  icon,
  iconColor,
  label,
  active,
  chevron = false,
  grow = false,
  wide = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  active: boolean;
  chevron?: boolean;
  /** Divide o espaço livre da linha (Filtros e Streaming); "Nota" fica mínima. */
  grow?: boolean;
  /** Fatia ainda maior do espaço livre (Streaming). */
  wide?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.pill,
        grow && styles.pillGrow,
        wide && styles.pillWide,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: active ? theme.accent : theme.backgroundSelected,
        },
      ]}
      onPress={onPress}>
      <Ionicons name={icon} size={14} color={iconColor ?? (active ? theme.accent : theme.textSecondary)} />
      <ThemedText
        type="small"
        numberOfLines={1}
        style={[styles.pillLabel, { color: active ? theme.accent : theme.text }]}>
        {label}
      </ThemedText>
      {chevron ? (
        <Ionicons
          name="chevron-down"
          size={13}
          color={active ? theme.accent : theme.textSecondary}
        />
      ) : null}
    </Pressable>
  );
}

export default function SearchScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [mode, setMode] = useState<SearchMode>('tv');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [genreId, setGenreId] = useState<number | null>(null);
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [ratingBuckets, setRatingBuckets] = useState<number[]>([]);
  const [ratingSheetOpen, setRatingSheetOpen] = useState(false);
  const [providers, setProviders] = useState<TmdbWatchProvider[]>([]);
  const [providerIds, setProviderIds] = useState<number[]>([]);
  const [streamingSheetOpen, setStreamingSheetOpen] = useState(false);
  const [yearRange, setYearRange] = useState<YearRange | null>(null);
  // Séries seguidas, filmes em "para assistir" e filmes já assistidos —
  // alimentam o botão do canto de cada card. Recarrega ao focar a aba.
  const [followedIds, setFollowedIds] = useState<Set<number>>(new Set());
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());
  const [watchedMovieIds, setWatchedMovieIds] = useState<Set<number>>(new Set());
  const [quickBusyIds, setQuickBusyIds] = useState<Set<number>>(new Set());
  // Sobe a cada mudança nos sets acima para a FlatList redesenhar os "+".
  const [cardStateVersion, setCardStateVersion] = useState(0);
  // Invalida respostas de requisições antigas quando query/modo/filtros mudam,
  // para uma busca lenta não sobrescrever a lista da busca atual.
  const requestId = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      Promise.all([
        getFollowedShows(user.id),
        getWatchlistMovies(user.id),
        getWatchedMovies(user.id),
      ])
        .then(([shows, watchlist, watched]) => {
          if (cancelled) return;
          setFollowedIds(new Set(shows.map((show) => show.tmdb_id)));
          setWatchlistIds(new Set(watchlist.map((movie) => movie.tmdb_id)));
          setWatchedMovieIds(new Set(watched.map((movie) => movie.tmdb_id)));
          setCardStateVersion((version) => version + 1);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  /** Toque no "+" do card: segue a série / põe o filme em "Para assistir" (e desfaz no toque seguinte). */
  async function toggleQuickAdd(item: SearchResult) {
    if (!user || quickBusyIds.has(item.id)) return;
    // Filme já assistido: o botão vira ✓ e não faz nada.
    if (mode === 'movie' && watchedMovieIds.has(item.id)) return;
    const isTv = mode === 'tv';
    const setIds = isTv ? setFollowedIds : setWatchlistIds;
    const alreadyIn = (isTv ? followedIds : watchlistIds).has(item.id);

    const flip = (add: boolean) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (add) next.add(item.id);
        else next.delete(item.id);
        return next;
      });

    setQuickBusyIds((prev) => new Set(prev).add(item.id));
    flip(!alreadyIn);
    setCardStateVersion((version) => version + 1);
    try {
      if (isTv) {
        if (alreadyIn) {
          await unfollowShow(user.id, item.id);
        } else {
          const names = await getShowNames(item.id);
          await followShow(user.id, {
            tmdb_id: item.id,
            ...names,
            poster_path: item.poster_path,
          });
        }
        syncEpisodeNotifications(user.id).catch(() => {});
      } else if (alreadyIn) {
        await removeMovieFromWatchlist(user.id, item.id);
      } else {
        const names = await getMovieNames(item.id);
        await addMovieToWatchlist(user.id, {
          tmdb_id: item.id,
          ...names,
          poster_path: item.poster_path,
        });
      }
    } catch {
      flip(alreadyIn); // desfaz o otimismo
      Alert.alert(t('search.followError'));
    } finally {
      setQuickBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setCardStateVersion((version) => version + 1);
    }
  }

  // Limpa lista e filtros ao alternar Séries/Filmes — evita mostrar (e navegar
  // para) resultados do modo anterior, e os ids de gênero diferem entre os dois.
  useEffect(() => {
    setResults(null);
    setGenreId(null);
    setRatingBuckets([]);
    setProviderIds([]);
    setYearRange(null);
    getGenres(mode)
      .then(setGenres)
      .catch(() => setGenres([]));
    getStreamingProviders(mode)
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [mode]);

  const fetchResults = useCallback(
    async (pageNumber: number) => {
      const trimmed = query.trim();
      const hasFilters =
        genreId !== null ||
        ratingBuckets.length > 0 ||
        providerIds.length > 0 ||
        yearRange !== null;
      const yearFilters = {
        yearFrom: yearRange?.from ?? null,
        yearTo: yearRange?.to ?? null,
      };
      const ratingFilters = {
        ratingFrom: ratingBuckets.length ? Math.min(...ratingBuckets) : null,
        ratingTo: ratingBuckets.length ? Math.max(...ratingBuckets) + 1 : null,
      };
      if (mode === 'tv') {
        const data = trimmed
          ? await searchShows(trimmed, pageNumber)
          : hasFilters
            ? await discoverShows({
                genreId,
                ...ratingFilters,
                providerIds,
                ...yearFilters,
                page: pageNumber,
              })
            : await getPopularShows(pageNumber);
        const items = data.results.map(fromShow);
        if (trimmed && pageNumber === 1) {
          const seenIds = new Set(items.map((i) => i.id));
          items.push(...(await searchJoined(trimmed, 'tv', seenIds)));
          items.push(...(await searchByCast(trimmed, 'tv', seenIds)));
        }
        return { items, totalPages: data.total_pages };
      }
      const data = trimmed
        ? await searchMovies(trimmed, pageNumber)
        : hasFilters
          ? await discoverMovies({
              genreId,
              ...ratingFilters,
              providerIds,
              ...yearFilters,
              page: pageNumber,
            })
          : await getPopularMovies(pageNumber);
      const items = data.results.map(fromMovie);
      if (trimmed && pageNumber === 1) {
        const seenIds = new Set(items.map((i) => i.id));
        items.push(...(await searchJoined(trimmed, 'movie', seenIds)));
        items.push(...(await searchByCast(trimmed, 'movie', seenIds)));
      }
      return { items, totalPages: data.total_pages };
    },
    [query, mode, genreId, ratingBuckets, providerIds, yearRange]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    const id = ++requestId.current;

    // Debounce: espera o usuário parar de digitar antes de chamar a API.
    const timer = setTimeout(
      async () => {
        try {
          const data = await fetchResults(1);
          if (requestId.current !== id) return;
          setResults(data.items);
          setPage(1);
          setTotalPages(data.totalPages);
        } catch (err) {
          if (requestId.current !== id) return;
          setError(err instanceof Error ? err.message : t('search.searchError'));
        } finally {
          if (requestId.current === id) setLoading(false);
        }
      },
      query.trim() ? 400 : 0
    );

    return () => clearTimeout(timer);
  }, [query, fetchResults, t]);

  async function handleLoadMore() {
    if (loading || loadingMore || results === null || page >= totalPages) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const data = await fetchResults(nextPage);
      if (requestId.current !== id) return;
      setPage(nextPage);
      setResults((previous) => {
        // O TMDB às vezes repete títulos entre páginas; remove duplicados
        // para não quebrar as keys da lista.
        const seen = new Set((previous ?? []).map((item) => item.id));
        return [...(previous ?? []), ...data.items.filter((item) => !seen.has(item.id))];
      });
    } catch {
      // Falha ao paginar não derruba a lista; rolar de novo tenta outra vez.
    } finally {
      setLoadingMore(false);
    }
  }

  const hasFilters =
    genreId !== null ||
    ratingBuckets.length > 0 ||
    providerIds.length > 0 ||
    yearRange !== null;
  const filterActive = genreId !== null || yearRange !== null;
  // Rótulos curtos para caber nas 3 pílulas. Nota: "Nota" ou "Nota 6+" (menor
  // faixa marcada). Streaming: nome do serviço, ou "Streaming (N)".
  const ratingLabel =
    ratingBuckets.length === 0
      ? t('search.rating')
      : `${t('search.rating')} ${Math.min(...ratingBuckets)}+`;
  const firstProviderName =
    providers.find((provider) => provider.provider_id === providerIds[0])?.provider_name ?? null;
  const streamingLabel =
    providerIds.length === 0
      ? t('search.streaming')
      : providerIds.length === 1 && firstProviderName
        ? firstProviderName
        : `${t('search.streaming')} (${providerIds.length})`;

  const ratingOptions: ActionSheetOption[] = [
    {
      label: t('search.ratingAny'),
      selected: ratingBuckets.length === 0,
      onPress: () => setRatingBuckets([]),
    },
    ...RATING_BUCKETS.map((value) => ({
      label: `${value}+`,
      selected: ratingBuckets.includes(value),
      onPress: () =>
        setRatingBuckets((prev) =>
          prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
        ),
    })),
  ];
  const streamingOptions: ActionSheetOption[] = [
    {
      label: t('search.streamingAny'),
      selected: providerIds.length === 0,
      onPress: () => setProviderIds([]),
    },
    ...providers.map((provider) => ({
      label: provider.provider_name,
      selected: providerIds.includes(provider.provider_id),
      onPress: () =>
        setProviderIds((prev) =>
          prev.includes(provider.provider_id)
            ? prev.filter((id) => id !== provider.provider_id)
            : [...prev, provider.provider_id]
        ),
    })),
  ];

  return (
    // Pressable de fundo: tocar em qualquer área "morta" da tela fecha o
    // teclado (toques em botões/cards são capturados pelos filhos antes).
    <Pressable
      style={[styles.container, { backgroundColor: theme.background }]}
      accessible={false}
      onPress={Keyboard.dismiss}>
      <View style={styles.searchRow}>
        <View style={[styles.modeToggle, { backgroundColor: theme.backgroundElement }]}>
          <Pressable
            style={[styles.modeButton, mode === 'tv' && { backgroundColor: theme.gold }]}
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
              {t('search.tvTab')}
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'movie' && { backgroundColor: theme.gold }]}
            onPress={() => setMode('movie')}>
            <Entypo
              name="clapperboard"
              size={14}
              color={mode === 'movie' ? '#231A00' : theme.textSecondary}
            />
            <ThemedText
              type="small"
              style={{ color: mode === 'movie' ? '#231A00' : theme.textSecondary }}>
              {t('search.movieTab')}
            </ThemedText>
          </Pressable>
        </View>
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder={mode === 'tv' ? t('search.tvPlaceholder') : t('search.moviePlaceholder')}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
      {!query.trim() && (
        <>
          {/* Filtros / Nota / Streaming — cada pílula abre um seletor. */}
          <View style={styles.pillRow}>
            <FilterPill
              icon="options-outline"
              label={t('search.filters')}
              active={filterActive}
              grow
              onPress={() => setGenreSheetOpen(true)}
            />
            <FilterPill
              icon="star"
              iconColor={theme.gold}
              label={ratingLabel}
              active={ratingBuckets.length > 0}
              chevron
              onPress={() => setRatingSheetOpen(true)}
            />
            <FilterPill
              icon="play-circle"
              label={streamingLabel}
              active={providerIds.length > 0}
              chevron
              grow
              wide
              onPress={() => setStreamingSheetOpen(true)}
            />
          </View>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            {hasFilters ? t('search.filterResults') : t('search.popularNow')}
            {providerIds.length > 0 ? t('search.justWatchData') : ''}
          </ThemedText>
        </>
      )}
      <ActionSheet
        visible={ratingSheetOpen}
        title={t('search.ratingTitle')}
        options={ratingOptions}
        closeOnSelect={false}
        onClose={() => setRatingSheetOpen(false)}
      />
      <ActionSheet
        visible={streamingSheetOpen}
        title={t('search.streamingTitle')}
        options={streamingOptions}
        scrollable
        closeOnSelect={false}
        onClose={() => setStreamingSheetOpen(false)}
      />
      <DiscoverFilterSheet
        visible={genreSheetOpen}
        genres={genres}
        selectedId={genreId}
        onSelect={setGenreId}
        yearRange={yearRange}
        onYearChange={setYearRange}
        onClose={() => setGenreSheetOpen(false)}
      />
      {error ? (
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      ) : loading && !results ? (
        <ActivityIndicator style={styles.message} />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(item) => `${mode}-${item.id}`}
          numColumns={3}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          extraData={`${mode}-${cardStateVersion}`}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footerLoading} /> : null
          }
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.message}>
              {mode === 'tv' ? t('search.noShowsFound') : t('search.noMoviesFound')}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <ShowCard
              tmdbId={item.id}
              name={item.name}
              posterPath={item.poster_path}
              subtitle={item.viaActor ? t('search.castPrefix', { name: item.viaActor }) : item.year}
              rating={item.rating}
              media={mode}
              onQuickAdd={user ? () => toggleQuickAdd(item) : undefined}
              quickAddState={
                mode === 'movie' && watchedMovieIds.has(item.id)
                  ? 'done'
                  : (mode === 'tv' ? followedIds : watchlistIds).has(item.id)
                    ? 'listed'
                    : 'none'
              }
              quickAddBusy={quickBusyIds.has(item.id)}
            />
          )}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: 2,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 7,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  sectionTitle: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  pill: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: Radius.md,
    borderWidth: 1,
    // Base no tamanho do texto; o espaço que sobra é dividido pelas pílulas
    // "grow" (ver pillGrow/pillWide) — "Nota" fica no tamanho mínimo.
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
  },
  pillGrow: {
    flexGrow: 1,
    flexShrink: 1,
  },
  pillWide: {
    // Streaming ganha uma fatia maior do espaço livre que "Filtros".
    flexGrow: 1.7,
  },
  pillLabel: {
    flexShrink: 1,
  },
  list: {
    padding: Spacing.two,
  },
  footerLoading: {
    marginVertical: Spacing.three,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
});
