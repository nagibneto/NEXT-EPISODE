import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ShareWatchedSheet } from '@/components/share-watched-sheet';
import { SkippedEpisodesSheet } from '@/components/skipped-episodes-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  followShowsBulk,
  getWatchedEpisodes,
  markEpisodeWatched,
  markSeasonWatched,
  onEpisodeWatchedChange,
  unmarkSeasonWatched,
} from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { syncEpisodeNotifications } from '@/lib/notifications';
import {
  getSeasonDetails,
  getShowDetailsCached,
  getShowNames,
  isLatestAiredEpisode,
  posterUrl,
  stillUrl,
  type TmdbEpisode,
  type TmdbSeasonDetails,
} from '@/lib/tmdb';
import {
  getSkippedEpisodes,
  markSkippedEpisodesWatched,
  type SkippedEpisode,
} from '@/lib/watch-next';

export default function SeasonScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; seasonNumber: string }>();
  const showId = Number(params.id);
  const seasonNumber = Number(params.seasonNumber);

  const [season, setSeason] = useState<TmdbSeasonDetails | null>(null);
  const [watched, setWatched] = useState<Set<number>>(new Set());
  const [showName, setShowName] = useState<string | null>(null);
  const [lastEpisodeToAir, setLastEpisodeToAir] = useState<TmdbEpisode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingSeason, setMarkingSeason] = useState(false);
  // Episódio sendo marcado que deixou episódios anteriores pulados, aguardando confirmação.
  const [skippedPrompt, setSkippedPrompt] = useState<{
    episodeNumber: number;
    skipped: SkippedEpisode[];
  } | null>(null);
  const [shareCard, setShareCard] = useState<{
    imageUrl: string | null;
    badgeLabel: string;
    title: string;
    subtitle?: string;
  } | null>(null);
  // Evita repetir o upsert de "seguir" a cada episódio marcado nesta tela.
  const followEnsured = useRef(false);

  /**
   * Marcar um episódio como assistido também passa a seguir a série, para ela
   * aparecer na watchlist. O upsert ignora duplicados, então é seguro chamar
   * mesmo que o usuário já siga.
   */
  const ensureFollowing = useCallback(async () => {
    if (!user || followEnsured.current) return;
    try {
      const show = await getShowDetailsCached(showId);
      const names = await getShowNames(show.id);
      await followShowsBulk(user.id, [{ tmdb_id: show.id, ...names, poster_path: show.poster_path }]);
      followEnsured.current = true;
      syncEpisodeNotifications(user.id).catch(() => {});
    } catch {
      // Seguir é efeito colateral: falhar aqui não deve desfazer o "assistido".
    }
  }, [user, showId]);

  useEffect(() => {
    getSeasonDetails(showId, seasonNumber)
      .then(setSeason)
      .catch((err) =>
        setError(err instanceof Error ? err.message : t('season.loadError'))
      );
    getShowDetailsCached(showId)
      .then((show) => {
        setShowName(show.name);
        setLastEpisodeToAir(show.last_episode_to_air);
      })
      .catch(() => {});
  }, [showId, seasonNumber]);

  // Refaz a busca de assistidos toda vez que a tela volta ao foco, para
  // refletir marcações feitas na tela de detalhes do episódio.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          setWatched(
            new Set(
              episodes
                .filter((episode) => episode.season_number === seasonNumber)
                .map((episode) => episode.episode_number)
            )
          );
        })
        .catch(() => {});
    }, [showId, seasonNumber, user])
  );

  // Sincroniza na hora com marcações feitas em outras telas (ex.: detalhes do
  // episódio). Diferente do refetch por foco acima, isto não corre risco de
  // chegar antes da escrita: o evento só dispara depois dela terminar.
  useEffect(() => {
    return onEpisodeWatchedChange((changedShowId, changedSeason, episodeNumbers, isWatched) => {
      if (changedShowId !== showId || changedSeason !== seasonNumber) return;
      setWatched((current) => {
        const next = new Set(current);
        if (episodeNumbers === 'all') {
          next.clear();
        } else {
          for (const episodeNumber of episodeNumbers) {
            if (isWatched) next.add(episodeNumber);
            else next.delete(episodeNumber);
          }
        }
        return next;
      });
    });
  }, [showId, seasonNumber]);

  const commitWatched = useCallback(
    async (episodeNumber: number, nextWatched: boolean, extraSkipped: SkippedEpisode[] = []) => {
      if (!user) return;
      // Atualização otimista: reflete o toque na hora e desfaz se a API falhar.
      setWatched((current) => {
        const next = new Set(current);
        if (nextWatched) next.add(episodeNumber);
        else next.delete(episodeNumber);
        return next;
      });
      try {
        await markEpisodeWatched(user.id, showId, seasonNumber, episodeNumber, nextWatched);
        if (nextWatched) {
          ensureFollowing();
          const isLastOfSeason = !!season && episodeNumber === season.episodes.length;
          if (isLastOfSeason || isLatestAiredEpisode(lastEpisodeToAir, seasonNumber, episodeNumber)) {
            const ep = season?.episodes.find((e) => e.episode_number === episodeNumber);
            setShareCard({
              imageUrl: stillUrl(ep?.still_path ?? null, 'original') ?? posterUrl(season?.poster_path ?? null, 'w500'),
              badgeLabel: t('shareWatchedSheet.seasonBadge'),
              title: showName ?? season?.name ?? '',
              subtitle: [`${t('common.nav.season')} ${seasonNumber}`, ep?.name].filter(Boolean).join(' · '),
            });
          }
        }
        if (extraSkipped.length > 0) {
          await markSkippedEpisodesWatched(user.id, showId, extraSkipped);
        }
      } catch {
        setWatched((current) => {
          const next = new Set(current);
          if (nextWatched) next.delete(episodeNumber);
          else next.add(episodeNumber);
          return next;
        });
      }
    },
    [user, showId, seasonNumber, ensureFollowing, season, lastEpisodeToAir, showName, t]
  );

  const toggleWatched = useCallback(
    async (episodeNumber: number) => {
      if (!user) return;
      const isWatched = watched.has(episodeNumber);

      if (isWatched) {
        commitWatched(episodeNumber, false);
        return;
      }

      // Marcando como assistido: avisa se ficaram episódios anteriores pulados.
      const skipped = await getSkippedEpisodes(user.id, showId, seasonNumber, episodeNumber).catch(
        () => []
      );
      if (skipped.length > 0) {
        setSkippedPrompt({ episodeNumber, skipped });
        return;
      }

      commitWatched(episodeNumber, true);
    },
    [user, watched, showId, seasonNumber, commitWatched]
  );

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!season) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const releasedEpisodes = season.episodes.filter(
    (episode) => !!episode.air_date && episode.air_date <= today
  );
  const allWatched =
    releasedEpisodes.length > 0 &&
    releasedEpisodes.every((episode) => watched.has(episode.episode_number));

  async function toggleSeasonWatched() {
    if (!user || !season || markingSeason) return;
    setMarkingSeason(true);
    const previous = watched;
    try {
      if (allWatched) {
        setWatched(new Set());
        await unmarkSeasonWatched(user.id, showId, seasonNumber);
      } else {
        setWatched(new Set(releasedEpisodes.map((episode) => episode.episode_number)));
        await markSeasonWatched(
          user.id,
          showId,
          seasonNumber,
          releasedEpisodes.map((episode) => episode.episode_number)
        );
        ensureFollowing();
        const finale = releasedEpisodes[releasedEpisodes.length - 1];
        const isLastOfSeason = finale.episode_number === season.episodes.length;
        if (
          isLastOfSeason ||
          isLatestAiredEpisode(lastEpisodeToAir, seasonNumber, finale.episode_number)
        ) {
          setShareCard({
            imageUrl: posterUrl(season.poster_path, 'w500') ?? stillUrl(finale.still_path, 'original'),
            badgeLabel: t('shareWatchedSheet.seasonBadge'),
            title: showName ?? season.name,
            subtitle: `${t('common.nav.season')} ${seasonNumber}`,
          });
        }
      }
    } catch {
      // Desfaz a atualização otimista se a API falhar.
      setWatched(previous);
    } finally {
      setMarkingSeason(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: season.name }} />
      <FlatList
        data={season.episodes}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          releasedEpisodes.length > 0 ? (
            <Pressable
              style={[
                styles.seasonButton,
                {
                  backgroundColor: allWatched ? theme.backgroundElement : theme.accent,
                  opacity: markingSeason ? 0.6 : 1,
                },
              ]}
              disabled={markingSeason}
              onPress={toggleSeasonWatched}>
              <Ionicons
                name={allWatched ? 'close-circle-outline' : 'checkmark-done'}
                size={18}
                color={allWatched ? theme.text : theme.accentText}
              />
              <ThemedText
                type="smallBold"
                style={{ color: allWatched ? theme.text : theme.accentText }}>
                {allWatched ? t('season.unmarkAll') : t('season.markAll')}
              </ThemedText>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const released = !!item.air_date && item.air_date <= today;
          const still = stillUrl(item.still_path);
          const isWatched = watched.has(item.episode_number);
          return (
            <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <Link
                href={{
                  pathname: '/episode/[showId]/[seasonNumber]/[episodeNumber]',
                  params: {
                    showId: String(showId),
                    seasonNumber: String(seasonNumber),
                    episodeNumber: String(item.episode_number),
                  },
                }}
                asChild>
                <Pressable style={styles.episodePressable}>
                  {still ? (
                    <Image source={{ uri: still }} style={styles.still} contentFit="cover" />
                  ) : (
                    <View style={[styles.still, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.episodeText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.episode_number}. {item.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {item.air_date
                        ? formatDate(`${item.air_date}T00:00:00`)
                        : t('season.dateNotAnnounced')}
                      {!released && ` · ${t('season.comingSoon')}`}
                    </ThemedText>
                  </View>
                </Pressable>
              </Link>
              {released && (
                <Pressable
                  hitSlop={8}
                  style={styles.watchedButton}
                  onPress={() => toggleWatched(item.episode_number)}>
                  <Ionicons
                    name={isWatched ? 'checkmark-circle' : 'ellipse-outline'}
                    size={28}
                    color={isWatched ? theme.accent : theme.textSecondary}
                  />
                </Pressable>
              )}
            </View>
          );
        }}
      />
      <SkippedEpisodesSheet
        visible={skippedPrompt !== null}
        count={skippedPrompt?.skipped.length ?? 0}
        onClose={() => setSkippedPrompt(null)}
        onSkip={() => {
          if (skippedPrompt) commitWatched(skippedPrompt.episodeNumber, true);
        }}
        onMarkAll={() => {
          if (skippedPrompt) commitWatched(skippedPrompt.episodeNumber, true, skippedPrompt.skipped);
        }}
      />
      <ShareWatchedSheet
        visible={shareCard !== null}
        onClose={() => setShareCard(null)}
        imageUrl={shareCard?.imageUrl ?? null}
        badgeLabel={shareCard?.badgeLabel ?? ''}
        title={shareCard?.title ?? ''}
        subtitle={shareCard?.subtitle}
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
  },
  message: {
    textAlign: 'center',
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  episodePressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  still: {
    width: 100,
    height: 64,
  },
  episodeText: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    gap: Spacing.half,
  },
  watchedButton: {
    paddingHorizontal: Spacing.two,
  },
  seasonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: Spacing.one,
  },
});
