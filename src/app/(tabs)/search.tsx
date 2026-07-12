import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getPopularMovies,
  getPopularShows,
  searchMovies,
  searchShows,
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

export default function SearchScreen() {
  const theme = useTheme();
  const [mode, setMode] = useState<SearchMode>('tv');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Limpa a lista ao alternar Séries/Filmes — evita mostrar (e navegar para)
  // resultados do modo anterior enquanto a nova busca carrega.
  useEffect(() => {
    setResults(null);
  }, [mode]);

  useEffect(() => {
    const trimmed = query.trim();
    setLoading(true);
    setError(null);

    // Debounce: espera o usuário parar de digitar antes de chamar a API.
    const timer = setTimeout(async () => {
      try {
        if (mode === 'tv') {
          const data = trimmed ? await searchShows(trimmed) : await getPopularShows();
          setResults(data.results.map(fromShow));
        } else {
          const data = trimmed ? await searchMovies(trimmed) : await getPopularMovies();
          setResults(data.results.map(fromMovie));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao buscar.');
      } finally {
        setLoading(false);
      }
    }, trimmed ? 400 : 0);

    return () => clearTimeout(timer);
  }, [query, mode]);

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
      {!query.trim() && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          Populares no momento
        </ThemedText>
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
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  modeButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sectionTitle: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  list: {
    padding: Spacing.two,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
});
