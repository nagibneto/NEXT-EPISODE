import Ionicons from '@expo/vector-icons/Ionicons';
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
import { useAuth } from '@/hooks/use-auth';
import { useQuickAdd } from '@/hooks/use-quick-add';
import { useTheme } from '@/hooks/use-theme';
import { getWatchlistMovies } from '@/lib/db';
import { formatDate, localizedTitle } from '@/lib/locale';
import { getMovieReleaseDates } from '@/lib/movie-releases';
import { getUpcomingMovies, localToday, posterUrl } from '@/lib/tmdb';
import { buildDateSections, daysUntil, relativeLabel, type DateSection } from '@/lib/upcoming-sections';

interface UpcomingMovie {
  id: number;
  title: string;
  posterPath: string | null;
  /** Estreia na região do usuário (YYYY-MM-DD). */
  date: string;
}

interface UpcomingMoviesData {
  /** Filmes da lista "Para assistir" que ainda vão estrear. */
  mine: UpcomingMovie[];
  /** Estreias de cinema da região, sem os que já estão em `mine`. */
  calendar: UpcomingMovie[];
}

/**
 * Modo "Filmes" da aba Em breve: primeiro os filmes da lista do usuário que
 * ainda vão estrear, depois o calendário de estreias de cinema da região. O
 * botão "Me avise" põe o filme na lista "Para assistir" — é ela que alimenta o
 * aviso do dia da estreia (ver scheduleMovieReleaseNotifications).
 */
export function UpcomingMovies() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const quickAdd = useQuickAdd();
  const [data, setData] = useState<UpcomingMoviesData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = i18n.language;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const [releases, watchlist] = await Promise.all([
        getUpcomingMovies(),
        getWatchlistMovies(user.id),
      ]);
      const dates = await getMovieReleaseDates(watchlist.map((movie) => movie.tmdb_id));
      const today = localToday();
      const mine: UpcomingMovie[] = [];
      for (const movie of watchlist) {
        const date = dates[movie.tmdb_id];
        if (!date || date < today) continue;
        mine.push({
          id: movie.tmdb_id,
          title: localizedTitle(movie.title, movie.title_en, language),
          posterPath: movie.poster_path,
          date,
        });
      }
      mine.sort((a, b) => (a.date < b.date ? -1 : 1));
      const mineIds = new Set(mine.map((movie) => movie.id));
      setData({
        mine,
        // A divisão é a do momento da carga: ativar "Me avise" num filme do
        // calendário não o tira do lugar enquanto a tela está aberta.
        calendar: releases
          .filter((movie) => !mineIds.has(movie.id))
          .map((movie) => ({
            id: movie.id,
            title: movie.title,
            posterPath: movie.poster_path,
            date: movie.release_date!,
          })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upcoming.moviesLoadError'));
    }
  }, [user, t, language]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sections = useMemo(() => {
    if (!data) return [];
    const list: DateSection<UpcomingMovie>[] = [];
    if (data.mine.length > 0) {
      list.push({ key: 'mine', title: t('upcoming.myList'), soon: false, data: data.mine });
    }
    return list.concat(buildDateSections(data.calendar, (movie) => movie.date, t));
    // Os títulos dos meses vêm de formatDate(), que depende do idioma ativo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, language]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (data === null && !error) {
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
      keyExtractor={(item) => String(item.id)}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[styles.list, !sections.length && styles.listEmpty]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        sections.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {t('upcoming.moviesHint')}
          </ThemedText>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {section.title}
        </ThemedText>
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <ThemedText type="subtitle" style={styles.message}>
            {t('upcoming.moviesEmptyTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {t('upcoming.moviesEmptyBody')}
          </ThemedText>
        </View>
      }
      renderItem={({ item }) => {
        const poster = posterUrl(item.posterPath, 'w185');
        const days = daysUntil(item.date);
        const state = quickAdd.stateFor('movie', item.id);
        const listed = state === 'listed';
        const busy = quickAdd.isBusy('movie', item.id);
        return (
          <Link href={{ pathname: '/movie/[id]', params: { id: String(item.id) } }} asChild>
            {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
            <Pressable
              style={StyleSheet.flatten([styles.row, { backgroundColor: theme.backgroundElement }])}>
              {poster ? (
                <Image
                  source={{ uri: poster }}
                  style={styles.poster}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={String(item.id)}
                />
              ) : (
                <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
              )}
              <View style={styles.rowText}>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {item.title}
                </ThemedText>
                {days <= 7 ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {formatDate(`${item.date}T00:00:00`, { day: '2-digit', month: 'short' })}
                    {' · '}
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {relativeLabel(days, t)}
                    </ThemedText>
                  </ThemedText>
                ) : (
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.accent }}>
                    {formatDate(`${item.date}T00:00:00`, {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </ThemedText>
                )}
              </View>
              {/* Filme já assistido não precisa de aviso. */}
              {quickAdd.enabled && state !== 'done' ? (
                <Pressable
                  style={[
                    styles.notify,
                    { backgroundColor: listed ? theme.accent : theme.backgroundSelected },
                  ]}
                  hitSlop={10}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: listed }}
                  onPress={() =>
                    quickAdd.toggle('movie', { id: item.id, posterPath: item.posterPath })
                  }>
                  <Ionicons
                    name={listed ? 'notifications' : 'notifications-outline'}
                    size={14}
                    color={listed ? theme.accentText : theme.text}
                  />
                  <ThemedText
                    type="smallBold"
                    style={[styles.notifyLabel, { color: listed ? theme.accentText : theme.text }]}>
                    {listed ? t('upcoming.notifyOn') : t('upcoming.notifyMe')}
                  </ThemedText>
                </Pressable>
              ) : null}
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
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
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    // Respiro antes do bloco; o `gap` da lista já separa do item seguinte.
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
    paddingLeft: Spacing.three,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  notify: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: 6,
    marginRight: Spacing.two + Spacing.half,
  },
  notifyLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  message: {
    textAlign: 'center',
  },
});
