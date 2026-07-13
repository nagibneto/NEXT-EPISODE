import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

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
  searchMovies,
  searchShows,
  type TmdbGenre,
  type TmdbMovieSummary,
  type TmdbShowSummary,
} from '@/lib/tmdb';

type SearchMode = 'tv' | 'movie';

interface SearchResult {
  id: number;
  name: string;
  poster_path: string | null;
  year?: string;
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

const MIN_RATING_OPTIONS = [6, 7, 8] as const;

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
  const [minRating, setMinRating] = useState<number | null>(null);
  // Invalida respostas de requisições antigas quando query/modo/filtros mudam,
  // para uma busca lenta não sobrescrever a lista da busca atual.
  const requestId = useRef(0);

  // Limpa lista e filtros ao alternar Séries/Filmes — evita mostrar (e navegar
  // para) resultados do modo anterior, e os ids de gênero diferem entre os dois.
  useEffect(() => {
    setResults(null);
    setGenreId(null);
    setMinRating(null);
    getGenres(mode)
      .then(setGenres)
      .catch(() => setGenres([]));
  }, [mode]);

  const fetchResults = useCallback(
    async (pageNumber: number) => {
      const trimmed = query.trim();
      const hasFilters = genreId !== null || minRating !== null;
      if (mode === 'tv') {
        const data = trimmed
          ? await searchShows(trimmed, pageNumber)
          : hasFilters
            ? await discoverShows({ genreId, minRating, page: pageNumber })
            : await getPopularShows(pageNumber);
        return { items: data.results.map(fromShow), totalPages: data.total_pages };
      }
      const data = trimmed
        ? await searchMovies(trimmed, pageNumber)
        : hasFilters
          ? await discoverMovies({ genreId, minRating, page: pageNumber })
          : await getPopularMovies(pageNumber);
      return { items: data.results.map(fromMovie), totalPages: data.total_pages };
    },
    [query, mode, genreId, minRating]
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
          setError(err instanceof Error ? err.message : 'Erro ao buscar.');
        } finally {
          if (requestId.current === id) setLoading(false);
        }
      },
      query.trim() ? 400 : 0
    );

    return () => clearTimeout(timer);
  }, [query, fetchResults]);

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

  const hasFilters = genreId !== null || minRating !== null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        placeholder={mode === 'tv' ? 'Buscar séries…' : 'Buscar filmes…'}
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      <View style={styles.filterRow}>
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
        {!query.trim() && (
          <View style={styles.ratingGroup}>
            <Ionicons name="star" size={14} color={theme.gold} />
            {MIN_RATING_OPTIONS.map((value) => (
              <FilterChip
                key={value}
                label={`${value}+`}
                compact
                selected={minRating === value}
                onPress={() => setMinRating(minRating === value ? null : value)}
              />
            ))}
          </View>
        )}
      </View>
      {!query.trim() && (
        <>
          {genres.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.genreScroll}
              contentContainerStyle={styles.genreRow}
              keyboardShouldPersistTaps="handled">
              {genres.map((genre) => (
                <FilterChip
                  key={genre.id}
                  label={genre.name}
                  selected={genreId === genre.id}
                  onPress={() => setGenreId(genreId === genre.id ? null : genre.id)}
                />
              ))}
            </ScrollView>
          )}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            {hasFilters ? 'Resultados do filtro' : 'Populares no momento'}
          </ThemedText>
        </>
      )}
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
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footerLoading} /> : null
          }
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.message}>
              {mode === 'tv' ? 'Nenhuma série encontrada.' : 'Nenhum filme encontrado.'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <ShowCard
              tmdbId={item.id}
              name={item.name}
              posterPath={item.poster_path}
              subtitle={item.year}
              media={mode}
            />
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
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    margin: Spacing.three,
    marginBottom: Spacing.two,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
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
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  sectionTitle: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  genreScroll: {
    // ScrollView tem flexShrink 1 por padrão; sem zerar, a lista de
    // resultados abaixo esmaga a faixa e corta os chips ao meio.
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: Spacing.two,
  },
  genreRow: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
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
