import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GameCard } from '@/components/game-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useGameLibrary } from '@/hooks/use-game-library';
import { useGameLists } from '@/hooks/use-game-lists';
import { useTheme } from '@/hooks/use-theme';
import { ratingOutOfTen, releaseYear, searchGames, type GameSummary } from '@/lib/igdb';

const SEARCH_DEBOUNCE_MS = 400;
const TRENDING: readonly ['trending'] = ['trending'];

/**
 * Buscar no modo Games. Sem texto, mostra os populares do momento (como a
 * busca de séries/filmes faz).
 */
export function GameSearchView() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { statusFor, library } = useGameLibrary();
  const { lists } = useGameLists(TRENDING);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Descarta respostas de buscas antigas que cheguem depois da mais nova.
  const searchSeq = useRef(0);

  const isSearching = query.trim().length >= 2;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      searchSeq.current += 1;
      setResults(null);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      searchGames(trimmed)
        .then((games) => {
          if (seq !== searchSeq.current) return;
          setResults(games);
          setError(null);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults([]);
          setError(t('games.searchError'));
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, t]);

  const data = isSearching ? (results ?? []) : (lists.trending ?? []);
  const loading = isSearching ? results === null : lists.trending === undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={t('games.searchPlaceholder')}
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator size="small" />
        ) : query.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        numColumns={3}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
        contentContainerStyle={[styles.grid, !data.length && styles.gridEmpty]}
        extraData={library}
        ListHeaderComponent={
          !isSearching && data.length > 0 ? (
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              {t('games.popularNow')}
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            {loading ? (
              <ActivityIndicator />
            ) : (
              <ThemedText themeColor={error ? 'danger' : 'textSecondary'} style={styles.message}>
                {error ?? (isSearching ? t('games.noResults') : t('games.listError'))}
              </ThemedText>
            )}
          </View>
        }
        ListFooterComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>
            {t('games.attribution')}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <GameCard
            igdbId={item.id}
            name={item.name}
            coverId={item.coverId}
            subtitle={[releaseYear(item.releaseDate), item.platforms.slice(0, 2).join(', ')]
              .filter(Boolean)
              .join(' · ')}
            rating={ratingOutOfTen(item.rating)}
            status={statusFor(item.id)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.lg,
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
  sectionTitle: {
    fontSize: 18,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  grid: {
    padding: Spacing.two,
  },
  gridEmpty: {
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  attribution: {
    textAlign: 'center',
    fontSize: 11,
    paddingVertical: Spacing.three,
  },
});
