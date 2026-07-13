import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  followShowsBulk,
  getWatchedEpisodes,
  markEpisodeWatched,
  markSeasonWatched,
  unmarkSeasonWatched,
} from '@/lib/db';
import { syncEpisodeNotifications } from '@/lib/notifications';
import { getSeasonDetails, getShowDetailsCached, stillUrl, type TmdbSeasonDetails } from '@/lib/tmdb';

export default function SeasonScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; seasonNumber: string }>();
  const showId = Number(params.id);
  const seasonNumber = Number(params.seasonNumber);

  const [season, setSeason] = useState<TmdbSeasonDetails | null>(null);
  const [watched, setWatched] = useState<Set<number>>(new Set());
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
            new Set(
              episodes
                .filter((episode) => episode.season_number === seasonNumber)
                .map((episode) => episode.episode_number)
            )
          );
        })
        .catch(() => {});
    }
  }, [showId, seasonNumber, user]);

  const toggleWatched = useCallback(
    async (episodeNumber: number) => {
      if (!user) return;
      const isWatched = watched.has(episodeNumber);
      // Atualização otimista: reflete o toque na hora e desfaz se a API falhar.
      setWatched((current) => {
        const next = new Set(current);
        if (isWatched) next.delete(episodeNumber);
        else next.add(episodeNumber);
        return next;
      });
      try {
        await markEpisodeWatched(user.id, showId, seasonNumber, episodeNumber, !isWatched);
        if (!isWatched) ensureFollowing();
      } catch {
        setWatched((current) => {
          const next = new Set(current);
          if (isWatched) next.add(episodeNumber);
          else next.delete(episodeNumber);
          return next;
        });
      }
    },
    [user, watched, showId, seasonNumber, ensureFollowing]
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
                {allWatched ? 'Desmarcar temporada' : 'Marcar temporada como assistida'}
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
                        ? new Date(`${item.air_date}T00:00:00`).toLocaleDateString('pt-BR')
                        : 'Data não anunciada'}
                      {!released && ' · Em breve'}
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
