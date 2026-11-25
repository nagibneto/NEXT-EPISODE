import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { GameShelf } from '@/components/game-shelf';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useGameLibrary } from '@/hooks/use-game-library';
import { useGameLists } from '@/hooks/use-game-lists';
import { useTheme } from '@/hooks/use-theme';
import type { GameLibraryEntry } from '@/lib/db';
import { getGameDetails, type GameListName, type GameSummary } from '@/lib/igdb';

const LISTS: readonly GameListName[] = ['recent', 'top'];

/** Quantos jogos da coleção viram "Porque você jogou…". */
const MAX_ANCHORS = 2;

/**
 * Para você no modo Games: indicações a partir do que a pessoa joga ou já
 * zerou (jogos parecidos, segundo a IGDB), mais lançamentos e aclamados.
 */
export function GameDiscoverView() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { library, reload, statusFor } = useGameLibrary();
  const { lists, failed, reload: reloadLists } = useGameLists(LISTS);
  const [refreshing, setRefreshing] = useState(false);
  const [because, setBecause] = useState<{ anchor: GameLibraryEntry; games: GameSummary[] }[]>([]);

  // Âncoras: os mexidos por último entre jogando/zerei (a lista já vem
  // ordenada por updated_at). A chave evita refazer a busca a cada foco.
  const anchors = (library ?? [])
    .filter((entry) => entry.status === 'playing' || entry.status === 'completed' || entry.status === 'played')
    .slice(0, MAX_ANCHORS);
  const anchorKey = anchors.map((a) => a.igdb_id).join(',');

  useEffect(() => {
    if (!anchorKey) {
      setBecause([]);
      return;
    }
    let cancelled = false;
    const owned = new Set((library ?? []).map((entry) => entry.igdb_id));
    Promise.allSettled(anchors.map((anchor) => getGameDetails(anchor.igdb_id))).then((settled) => {
      if (cancelled) return;
      const next: { anchor: GameLibraryEntry; games: GameSummary[] }[] = [];
      settled.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        // Tira o que já está na coleção — indicação de algo que a pessoa já
        // tem não ajuda.
        const games = result.value.similar.filter((game) => !owned.has(game.id));
        next.push({ anchor: anchors[index], games });
      });
      setBecause(next);
    });
    return () => {
      cancelled = true;
    };
    // anchors/library mudam de identidade a cada foco; anchorKey resume o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  async function handleRefresh() {
    setRefreshing(true);
    reloadLists();
    await reload(true);
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
      {because.map(({ anchor, games }) => (
        <GameShelf
          key={anchor.igdb_id}
          title={t('games.becauseYouPlayed', { title: anchor.name })}
          games={games}
          statusFor={statusFor}
        />
      ))}
      {library !== null && anchors.length === 0 && (
        <View style={[styles.hint, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('games.discoverHint')}
          </ThemedText>
        </View>
      )}
      {failed ? (
        <View style={styles.error}>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            {t('games.listError')}
          </ThemedText>
          <Pressable
            style={[styles.button, { backgroundColor: theme.accent }]}
            onPress={reloadLists}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('common.retry')}
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        LISTS.map((name) => (
          <GameShelf
            key={name}
            title={t(`games.lists.${name}`)}
            games={lists[name] ?? null}
            statusFor={statusFor}
          />
        ))
      )}
      <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>
        {t('games.attribution')}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  hint: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.four,
    borderRadius: Radius.lg,
    padding: Spacing.three,
  },
  error: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  button: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
  },
  attribution: {
    textAlign: 'center',
    fontSize: 11,
    paddingHorizontal: Spacing.three,
  },
});
