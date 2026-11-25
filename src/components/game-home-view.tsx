import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { GameShelf } from '@/components/game-shelf';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { libraryEntryToSummary, useGameLibrary } from '@/hooks/use-game-library';
import { useGameLists } from '@/hooks/use-game-lists';
import { useTheme } from '@/hooks/use-theme';
import type { GameListName } from '@/lib/igdb';

const LISTS: readonly GameListName[] = ['trending', 'upcoming'];

/**
 * Início no modo Games: o que você está jogando e quer jogar, seguido do que
 * está em alta e dos lançamentos mais aguardados.
 */
export function GameHomeView() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { library, reload, statusFor } = useGameLibrary();
  const { lists, failed, reload: reloadLists } = useGameLists(LISTS);
  const [refreshing, setRefreshing] = useState(false);

  const playing = (library ?? []).filter((e) => e.status === 'playing').map(libraryEntryToSummary);
  const want = (library ?? []).filter((e) => e.status === 'want').map(libraryEntryToSummary);

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
      {/* A coleção aparece só quando tem algo; prateleira de 1–2 itens
          também vale aqui (é a lista da própria pessoa). */}
      {playing.length > 0 && (
        <GameShelf title={t('games.continuePlaying')} games={playing} minItems={1} />
      )}
      {want.length > 0 && (
        <GameShelf title={t('games.status.want')} games={want} minItems={1} />
      )}
      {library !== null && library.length === 0 && (
        <View style={[styles.welcome, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{t('games.welcomeTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('games.welcomeText')}
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
  welcome: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.four,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
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
