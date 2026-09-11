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

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getFollowedShows } from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { getShowDetails, posterUrl, type TmdbEpisode } from '@/lib/tmdb';

interface UpcomingItem {
  showId: number;
  showName: string;
  posterPath: string | null;
  episode: TmdbEpisode;
}

/** Uma faixa da lista: "Nos próximos 7 dias" ou um mês ("Outubro"). */
interface UpcomingSection {
  key: string;
  title: string;
  /** Estreias da semana ganham "Hoje/Amanhã/Em N dias" ao lado da data curta. */
  soon: boolean;
  data: UpcomingItem[];
}

/** Dias inteiros entre hoje (meia-noite local) e a data de exibição. */
function daysUntil(airDate: string): number {
  const date = new Date(`${airDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

/** Rótulo relativo curto da semana: "Hoje! 🎉", "Amanhã", "Em 5 dias". */
function relativeLabel(days: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (days <= 0) return t('upcoming.today');
  if (days === 1) return t('upcoming.tomorrow');
  return t('upcoming.inDays', { count: days });
}

/**
 * Agrupa os episódios em "Nos próximos 7 dias" e depois um bloco por mês. O
 * ano só entra no título do mês quando não é o atual (ex.: "Janeiro de 2027"),
 * para a lista não ficar poluída no caso comum.
 */
function buildSections(
  items: UpcomingItem[],
  t: ReturnType<typeof useTranslation>['t']
): UpcomingSection[] {
  const soon: UpcomingItem[] = [];
  const byMonth = new Map<string, UpcomingItem[]>();
  const thisYear = new Date().getFullYear();

  for (const item of items) {
    const airDate = item.episode.air_date!;
    if (daysUntil(airDate) <= 7) {
      soon.push(item);
      continue;
    }
    const monthKey = airDate.slice(0, 7); // YYYY-MM
    const list = byMonth.get(monthKey);
    if (list) list.push(item);
    else byMonth.set(monthKey, [item]);
  }

  const sections: UpcomingSection[] = [];
  if (soon.length > 0) {
    sections.push({ key: 'soon', title: t('upcoming.nextSevenDays'), soon: true, data: soon });
  }
  // O Map preserva a ordem de inserção e a lista já vem ordenada por data.
  for (const [monthKey, data] of byMonth) {
    const iso = `${monthKey}-01T00:00:00`;
    const sameYear = Number(monthKey.slice(0, 4)) === thisYear;
    const label = formatDate(iso, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
    sections.push({
      key: monthKey,
      // Intl devolve o mês em minúscula em pt-BR ("outubro").
      title: label.charAt(0).toUpperCase() + label.slice(1),
      soon: false,
      data,
    });
  }
  return sections;
}

export default function UpcomingScreen() {
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
    () => buildSections(items ?? [], t),
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
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
