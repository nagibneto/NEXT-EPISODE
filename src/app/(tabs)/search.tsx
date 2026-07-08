import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';

import { ShowCard } from '@/components/show-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPopularShows, searchShows, type TmdbShowSummary } from '@/lib/tmdb';

export default function SearchScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbShowSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    setLoading(true);
    setError(null);

    // Debounce: espera o usuário parar de digitar antes de chamar a API.
    const timer = setTimeout(async () => {
      try {
        const data = trimmed ? await searchShows(trimmed) : await getPopularShows();
        setResults(data.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao buscar séries.');
      } finally {
        setLoading(false);
      }
    }, trimmed ? 400 : 0);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        placeholder="Buscar séries…"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
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
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.message}>
              Nenhuma série encontrada.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <ShowCard
              tmdbId={item.id}
              name={item.name}
              posterPath={item.poster_path}
              subtitle={item.first_air_date ? item.first_air_date.slice(0, 4) : undefined}
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
