import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { usePremium } from '@/hooks/use-premium';
import {
  followShowsBulk,
  getWatchedEpisodes,
  markEpisodeWatched,
  markSeasonWatched,
  rewatchEpisodes,
  unmarkSeasonWatched,
} from '@/lib/db';
import { syncEpisodeNotifications } from '@/lib/notifications';
import { getSeasonDetails, getShowDetailsCached, stillUrl, type TmdbSeasonDetails } from '@/lib/tmdb';

export default function SeasonScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { isPremium } = usePremium();
  const params = useLocalSearchParams<{ id: string; seasonNumber: string }>();
  const showId = Number(params.id);
  const seasonNumber = Number(params.seasonNumber);

  const [season, setSeason] = useState<TmdbSeasonDetails | null>(null);
  // episódio → quantas vezes foi visto (ausente = não visto).
  const [watched, setWatched] = useState<Map<number, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [markingSeason, setMarkingSeason] = useState(false);
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
      await followShowsBulk(user.id, [
        { tmdb_id: show.id, name: show.name, poster_path: show.poster_path },
      ]);
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
        setError(err instanceof Error ? err.message : 'Erro ao carregar a temporada.')
      );
    if (user) {
      getWatchedEpisodes(user.id, showId)
        .then((episodes) => {
          setWatched(
            new Map(
              episodes
                .filter((episode) => episode.season_number === seasonNumber)
                .map((episode) => [episode.episode_number, episode.watch_count])
            )
          );
        })
        .catch(() => {});
    }
  }, [showId, seasonNumber, user]);

  const toggleWatched = useCallback(
    async (episodeNumber: number) => {
      if (!user) return;
      const previousCount = watched.get(episodeNumber);
      const isWatched = previousCount !== undefined;
      // Atualização otimista: reflete o toque na hora e desfaz se a API falhar.
      setWatched((current) => {
        const next = new Map(current);
        if (isWatched) next.delete(episodeNumber);
        else next.set(episodeNumber, 1);
        return next;
      });
      try {
        await markEpisodeWatched(user.id, showId, seasonNumber, episodeNumber, !isWatched);
        if (!isWatched) ensureFollowing();
      } catch {
        setWatched((current) => {
          const next = new Map(current);
          if (isWatched) next.set(episodeNumber, previousCount);
          else next.delete(episodeNumber);
          return next;
        });
      }
    },
    [user, watched, showId, seasonNumber, ensureFollowing]
  );

  /** "Vi de novo" (premium): +1 no episódio já assistido. */
  const rewatchEpisode = useCallback(
    async (episodeNumber: number) => {
      if (!user) return;
      const previousCount = watched.get(episodeNumber);
      if (previousCount === undefined) return;
      setWatched((current) => new Map(current).set(episodeNumber, previousCount + 1));
      try {
        await rewatchEpisodes(user.id, showId, seasonNumber, [episodeNumber]);
      } catch {
        setWatched((current) => new Map(current).set(episodeNumber, previousCount));
      }
    },
    [user, watched, showId, seasonNumber]
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
    if (!user || markingSeason) return;
    setMarkingSeason(true);
    const previous = watched;
    try {
      if (allWatched) {
        setWatched(new Map());
        await unmarkSeasonWatched(user.id, showId, seasonNumber);
      } else {
        setWatched(
          new Map(
            releasedEpisodes.map((episode) => [
              episode.episode_number,
              watched.get(episode.episode_number) ?? 1,
            ])
          )
        );
        await markSeasonWatched(
          user.id,
          showId,
          seasonNumber,
          releasedEpisodes.map((episode) => episode.episode_number)
        );
        ensureFollowing();
      }
    } catch {
      // Desfaz a atualização otimista se a API falhar.
      setWatched(previous);
    } finally {
      setMarkingSeason(false);
    }
  }

  /**
   * "Vi a temporada de novo": +1 em todos os episódios lançados. Aparece
   * quando a temporada inteira já foi vista; sem premium, abre o paywall.
   */
  async function rewatchSeason() {
    if (!user || markingSeason) return;
    if (!isPremium) {
      router.push('/paywall');
      return;
    }
    setMarkingSeason(true);
    const previous = watched;
    try {
      setWatched(
        new Map(
          releasedEpisodes.map((episode) => [
            episode.episode_number,
            (watched.get(episode.episode_number) ?? 0) + 1,
          ])
        )
      );
      await rewatchEpisodes(
        user.id,
        showId,
        seasonNumber,
        releasedEpisodes.map((episode) => episode.episode_number)
      );
    } catch {
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
            <View style={styles.seasonButtons}>
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
                  {allWatched ? 'Desmarcar tudo' : 'Marcar temporada como assistida'}
                </ThemedText>
              </Pressable>
              {/* Temporada já vista inteira: dá para rever (+1 em tudo; premium). */}
              {allWatched && (
                <Pressable
                  style={[
                    styles.seasonButton,
                    { backgroundColor: theme.backgroundElement, opacity: markingSeason ? 0.6 : 1 },
                  ]}
                  disabled={markingSeason}
                  onPress={rewatchSeason}>
                  <Ionicons name="repeat" size={18} color={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    Reassistido tudo
                  </ThemedText>
                  {!isPremium && <Ionicons name="lock-closed" size={14} color={theme.accent} />}
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const released = !!item.air_date && item.air_date <= today;
          const still = stillUrl(item.still_path);
          const watchCount = watched.get(item.episode_number);
          const isWatched = watchCount !== undefined;
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
                        ? new Date(`${item.air_date}T00:00:00`).toLocaleDateString('pt-BR')
                        : 'Data não anunciada'}
                      {!released && ' · Em breve'}
                    </ThemedText>
                  </View>
                </Pressable>
              </Link>
              {released && (
                <>
                  {/* "Vi de novo": +1 no contador (premium; sem premium abre o paywall). */}
                  {isWatched && (
                    <Pressable
                      hitSlop={8}
                      style={styles.rewatchButton}
                      onPress={() =>
                        isPremium ? rewatchEpisode(item.episode_number) : router.push('/paywall')
                      }>
                      <Ionicons name="repeat" size={22} color={theme.textSecondary} />
                      {watchCount !== undefined && watchCount > 1 && (
                        <ThemedText type="smallBold" style={{ color: theme.accent, fontSize: 12 }}>
                          {watchCount}x
                        </ThemedText>
                      )}
                    </Pressable>
                  )}
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
                </>
              )}
            </View>
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
  rewatchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingLeft: Spacing.two,
  },
  // Lado a lado quando a temporada está completa (Desmarcar + Vi de novo).
  seasonButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  seasonButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: Spacing.one,
  },
});
