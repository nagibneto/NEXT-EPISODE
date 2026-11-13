import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';

import { StatusTabs } from '@/components/status-tabs';
import { ThemedText } from '@/components/themed-text';
import { UpcomingMovies } from '@/components/upcoming-movies';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getFollowedShows } from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { getShowDetails, posterUrl, type TmdbEpisode } from '@/lib/tmdb';
import { buildDateSections, daysUntil, relativeLabel } from '@/lib/upcoming-sections';

type UpcomingMode = 'tv' | 'movie';

interface UpcomingItem {
  showId: number;
  showName: string;
  posterPath: string | null;
  episode: TmdbEpisode;
}

/**
 * Aba "Em breve": abas Séries/Filmes no topo. Séries mostra os próximos
 * episódios do que o usuário segue; Filmes, as estreias (ver UpcomingMovies).
 */
export default function UpcomingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<UpcomingMode>('tv');
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusTabs
        options={[
          { value: 'tv', label: t('upcoming.tabShows') },
          { value: 'movie', label: t('upcoming.tabMovies') },
        ] as const}
        value={mode}
        onChange={setMode}
        style={styles.modeTabs}
      />
      {mode === 'tv' ? <UpcomingShows /> : <UpcomingMovies />}
    </View>
  );
}

function UpcomingShows() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const shows = await getFollowedShows(user.id);
      const details = await Promise.all(
        shows.map(async (show) => {
          try {
            return await getShowDetails(show.tmdb_id);
          } catch {
            return null;
          }
        })
      );
      const upcoming: UpcomingItem[] = [];
      for (const detail of details) {
        if (detail?.next_episode_to_air?.air_date) {
          upcoming.push({
            showId: detail.id,
            showName: detail.name,
            posterPath: detail.poster_path,
            episode: detail.next_episode_to_air,
          });
        }
      }
      upcoming.sort((a, b) => (a.episode.air_date! < b.episode.air_date! ? -1 : 1));
      setItems(upcoming);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upcoming.loadError'));
    }
  }, [user, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Os títulos das seções vêm de formatDate(), que depende do idioma ativo.
  const sections = useMemo(
    () => buildDateSections(items ?? [], (item) => item.episode.air_date!, t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, t, i18n.language]
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (items === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => `${item.showId}-${item.episode.id}`}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[styles.list, !sections.length && styles.listEmpty]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      renderSectionHeader={({ section }) => (
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {section.title}
        </ThemedText>
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <ThemedText type="subtitle" style={styles.message}>
            {t('upcoming.emptyTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {t('upcoming.emptyBody')}
          </ThemedText>
        </View>
      }
      renderItem={({ item, section }) => {
        const poster = posterUrl(item.posterPath, 'w185');
        const airDate = item.episode.air_date!;
        const days = daysUntil(airDate);
        return (
          <Link href={{ pathname: '/show/[id]', params: { id: String(item.showId) } }} asChild>
            {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
            <Pressable
              style={StyleSheet.flatten([
                styles.row,
                { backgroundColor: theme.backgroundElement },
              ])}>
              {poster ? (
                <Image
                  source={{ uri: poster }}
                  style={styles.poster}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={String(item.showId)}
                />
              ) : (
                <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
              )}
              <View style={styles.rowText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.showName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {t('home.seasonEpisodeCompact', {
                    season: String(item.episode.season_number).padStart(2, '0'),
                    episode: String(item.episode.episode_number).padStart(2, '0'),
                  })}
                  {item.episode.name ? ` · ${item.episode.name}` : ''}
                </ThemedText>
                {section.soon ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {formatDate(`${airDate}T00:00:00`, { day: '2-digit', month: 'short' })}
                    {' · '}
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {relativeLabel(days, t)}
                    </ThemedText>
                  </ThemedText>
                ) : (
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.accent }}>
                    {formatDate(`${airDate}T00:00:00`, {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  modeTabs: {
    marginTop: Spacing.two,
    marginBottom: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
    marginTop: Spacing.six,
  },
  list: {
    padding: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  // Faz o estado vazio ocupar a tela toda.
  listEmpty: {
    flexGrow: 1,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    // Respiro antes do bloco; o `gap` da lista já separa do item seguinte.
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  poster: {
    width: 64,
    height: 96,
  },
  rowText: {
    flex: 1,
    padding: Spacing.two,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  message: {
    textAlign: 'center',
  },
});
