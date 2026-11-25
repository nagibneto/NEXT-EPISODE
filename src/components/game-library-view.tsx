import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { GAME_STATUS_ICON, GameCard } from '@/components/game-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useGameLibrary } from '@/hooks/use-game-library';
import { useTheme } from '@/hooks/use-theme';
import { GAME_STATUSES, type GameStatus } from '@/lib/db';

type StatusFilter = GameStatus | 'all';

/**
 * Biblioteca (a Watchlist do modo Games): a coleção inteira em grade, com
 * filtro por status e a contagem de cada um.
 */
export function GameLibraryView() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { library, reload } = useGameLibrary();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const counts = useMemo(() => {
    const map: Record<GameStatus, number> = {
      want: 0,
      playing: 0,
      completed: 0,
      played: 0,
      dropped: 0,
    };
    for (const entry of library ?? []) map[entry.status] += 1;
    return map;
  }, [library]);

  const filtered = useMemo(
    () =>
      statusFilter === 'all'
        ? (library ?? [])
        : (library ?? []).filter((entry) => entry.status === statusFilter),
    [library, statusFilter]
  );

  async function handleRefresh() {
    setRefreshing(true);
    await reload(true);
    setRefreshing(false);
  }

  if (library === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {library.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsRow}>
          {(['all', ...GAME_STATUSES] as const).map((value) => {
            const active = statusFilter === value;
            const count = value === 'all' ? library.length : counts[value];
            return (
              <Pressable
                key={value}
                style={[styles.chip, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}
                onPress={() => setStatusFilter(value)}>
                {value !== 'all' && (
                  <Ionicons
                    name={GAME_STATUS_ICON[value]}
                    size={13}
                    color={active ? theme.accentText : theme.textSecondary}
                  />
                )}
                <ThemedText type="small" style={{ color: active ? theme.accentText : theme.text }}>
                  {value === 'all' ? t('games.all') : t(`games.status.${value}`)}
                  {count > 0 ? ` · ${count}` : ''}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.igdb_id)}
        numColumns={3}
        // Mesmo motivo do MediaGrid: no Android o recorte faz capas sumirem.
        removeClippedSubviews={false}
        contentContainerStyle={[styles.grid, !filtered.length && styles.gridEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          library.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="game-controller-outline" size={48} color={theme.textSecondary} />
              <ThemedText type="subtitle" style={styles.message}>
                {t('games.emptyLibraryTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                {t('games.emptyLibraryText')}
              </ThemedText>
              <Pressable
                style={[styles.button, { backgroundColor: theme.accent }]}
                onPress={() => router.navigate('/search')}>
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  {t('games.goSearch')}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.center}>
              <ThemedText themeColor="textSecondary" style={styles.message}>
                {statusFilter === 'all'
                  ? t('games.noResults')
                  : t('games.emptyStatus', { status: t(`games.status.${statusFilter}`) })}
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <GameCard
            igdbId={item.igdb_id}
            name={item.name}
            coverId={item.cover_image_id}
            // No "Todos" o selo diz o status; filtrado, seria repetido.
            status={statusFilter === 'all' ? item.status : null}
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
  chipsScroll: {
    flexGrow: 0,
  },
  chipsRow: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 6,
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
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
  },
  button: {
    marginTop: Spacing.two,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
  },
});
