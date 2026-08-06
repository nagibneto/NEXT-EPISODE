import Entypo from '@expo/vector-icons/Entypo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { GenreFilterSheet } from '@/components/genre-filter-sheet';
import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  discoverMovies,
  discoverShows,
  getGenres,
  getPopularMovies,
  getPopularShows,
  getStreamingProviders,
  providerLogoUrl,
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
  /** Preenchido quando o resultado veio de uma busca por ator, não pelo título. */
  viaActor?: string;
}

function fromShow(show: TmdbShowSummary): SearchResult {
  return {
    id: show.id,
    name: show.name,
    poster_path: show.poster_path,
    year: show.first_air_date ? show.first_air_date.slice(0, 4) : undefined,
  };
}

function fromMovie(movie: TmdbMovieSummary): SearchResult {
  return {
    id: movie.id,
    name: movie.title,
    poster_path: movie.poster_path,
    year: movie.release_date ? movie.release_date.slice(0, 4) : undefined,
  };
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

const MIN_RATING_OPTIONS = [5, 6, 7, 8, 9] as const;

/** Chip de filtro no formato pílula, usado para gêneros e nota mínima. */
function FilterChip({
  label,
  selected,
  compact = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.chip,
        compact && styles.chipCompact,
        { backgroundColor: selected ? theme.accent : theme.backgroundElement },
      ]}
      onPress={onPress}>
      <ThemedText type="small" style={{ color: selected ? theme.accentText : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function SearchScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
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
  const [minRating, setMinRating] = useState<number | null>(null);
  const [providers, setProviders] = useState<TmdbWatchProvider[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  // Invalida respostas de requisições antigas quando query/modo/filtros mudam,
  // para uma busca lenta não sobrescrever a lista da busca atual.
  const requestId = useRef(0);

  // Limpa lista e filtros ao alternar Séries/Filmes — evita mostrar (e navegar
  // para) resultados do modo anterior, e os ids de gênero diferem entre os dois.
  useEffect(() => {
    setResults(null);
    setGenreId(null);
    setMinRating(null);
    setProviderId(null);
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
      const hasFilters = genreId !== null || minRating !== null || providerId !== null;
      if (mode === 'tv') {
        const data = trimmed
          ? await searchShows(trimmed, pageNumber)
          : hasFilters
            ? await discoverShows({ genreId, minRating, providerId, page: pageNumber })
            : await getPopularShows(pageNumber);
        const items = data.results.map(fromShow);
        if (trimmed && pageNumber === 1) {
          items.push(...(await searchByCast(trimmed, 'tv', new Set(items.map((i) => i.id)))));
        }
        return { items, totalPages: data.total_pages };
      }
      const data = trimmed
        ? await searchMovies(trimmed, pageNumber)
        : hasFilters
          ? await discoverMovies({ genreId, minRating, providerId, page: pageNumber })
          : await getPopularMovies(pageNumber);
      const items = data.results.map(fromMovie);
      if (trimmed && pageNumber === 1) {
        items.push(...(await searchByCast(trimmed, 'movie', new Set(items.map((i) => i.id)))));
      }
      return { items, totalPages: data.total_pages };
    },
    [query, mode, genreId, minRating, providerId]
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

  const hasFilters = genreId !== null || minRating !== null || providerId !== null;

  return (
    // Pressable de fundo: tocar em qualquer área "morta" da tela fecha o
    // teclado (toques em botões/cards são capturados pelos filhos antes).
    <Pressable
      style={[styles.container, { backgroundColor: theme.background }]}
      accessible={false}
      onPress={Keyboard.dismiss}>
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
      <View style={styles.filterRow}>
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
              {t('search.tvTab')}
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
              {t('search.movieTab')}
            </ThemedText>
          </Pressable>
        </View>
        {!query.trim() && (
          <View style={styles.ratingGroup}>
            <Ionicons name="star" size={14} color={theme.gold} />
            {/* View de largura fixa limita o visível a ~3 chips; o ScrollView
                dentro dela rola o restante. */}
            <View style={styles.ratingScroll}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.ratingRow}
                keyboardShouldPersistTaps="handled">
                {MIN_RATING_OPTIONS.map((value) => (
                  <FilterChip
                    key={value}
                    label={`${value}+`}
                    compact
                    selected={minRating === value}
                    onPress={() => setMinRating(minRating === value ? null : value)}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </View>
      {!query.trim() && (
        <>
          {/* Categorias abre o mesmo bottom sheet da watchlist; ao lado, a
              faixa de streamings do Brasil rola na horizontal. */}
          <View style={styles.discoverRow}>
            <Pressable
              style={[
                styles.categoriesButton,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: genreId !== null ? theme.accent : theme.backgroundSelected,
                },
              ]}
              onPress={() => setGenreSheetOpen(true)}>
              <Ionicons
                name="filter"
                size={13}
                color={genreId !== null ? theme.accent : theme.textSecondary}
              />
              <ThemedText
                type="small"
                style={{ color: genreId !== null ? theme.accent : theme.text }}>
                {t('search.categories')}
              </ThemedText>
            </Pressable>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.providerScroll}
              contentContainerStyle={styles.providerRow}
              keyboardShouldPersistTaps="handled">
              {providers.map((provider) => {
                const selected = providerId === provider.provider_id;
                const logo = providerLogoUrl(provider.logo_path);
                return (
                  <Pressable
                    key={provider.provider_id}
                    style={[
                      styles.providerChip,
                      { backgroundColor: selected ? theme.accent : theme.backgroundElement },
                    ]}
                    onPress={() => setProviderId(selected ? null : provider.provider_id)}>
                    {logo && (
                      <Image source={{ uri: logo }} style={styles.providerLogo} contentFit="cover" />
                    )}
                    <ThemedText
                      type="small"
                      style={{ color: selected ? theme.accentText : theme.text }}>
                      {provider.provider_name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            {hasFilters ? t('search.filterResults') : t('search.popularNow')}
            {providerId !== null ? t('search.justWatchData') : ''}
          </ThemedText>
        </>
      )}
      <GenreFilterSheet
        visible={genreSheetOpen}
        genres={genres}
        selectedId={genreId}
        onSelect={setGenreId}
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
              media={mode}
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
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
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
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  ratingScroll: {
    // Largura de ~3 chips de nota; o resto aparece arrastando para o lado.
    width: 118,
    flexGrow: 0,
    flexShrink: 0,
  },
  ratingRow: {
    gap: Spacing.one,
    alignItems: 'center',
    paddingRight: Spacing.one,
  },
  sectionTitle: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  categoriesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 6,
  },
  providerScroll: {
    // flex 1 ocupa o resto da linha ao lado do botão Categorias. Cuidado:
    // flexGrow explícito vence o do shorthand flex e zeraria a largura.
    flex: 1,
    minWidth: 0,
  },
  providerRow: {
    gap: Spacing.two,
    alignItems: 'center',
    paddingRight: Spacing.one,
  },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: Spacing.two + Spacing.half,
    paddingVertical: 4,
  },
  providerLogo: {
    width: 22,
    height: 22,
    borderRadius: 999,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  chipCompact: {
    paddingHorizontal: Spacing.two + Spacing.half,
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
