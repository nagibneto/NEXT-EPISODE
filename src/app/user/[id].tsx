import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  getFriends,
  getFriendsEpisodeCounts,
  getFriendsMovieWatches,
  getProfile,
  getWatchedCounts,
  profileDisplayName,
  type Profile,
} from '@/lib/db';
import { formatDuration, shortDuration } from '@/lib/duration';
import { i18n } from '@/lib/i18n';
import {
  episodeRuntime,
  FALLBACK_MOVIE_RUNTIME_MIN,
  FALLBACK_RUNTIME_MIN,
  getMovieDetailsCached,
  getShowDetailsCached,
  posterUrl,
} from '@/lib/tmdb';

/** Quantas séries listar na seção "que mais assistiu"; a de "em comum" é um carrossel, sem limite. */
const TOP_SHOWS = 10;

interface ShowStat {
  tmdb_show_id: number;
  name: string;
  poster_path: string | null;
  episodes: number;
  minutes: number;
}

/** Série que os dois assistem, com a contagem de cada lado para comparar. */
interface CommonShow extends ShowStat {
  myEpisodes: number;
}

interface UserStats {
  totalMinutes: number;
  totalEpisodes: number;
  totalShows: number;
  totalMovies: number;
  shows: ShowStat[];
  common: CommonShow[];
}

/** Estatísticas públicas de um amigo, abertas ao tocar no avatar dele. */
export default function UserStatsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  /** null enquanto carrega; false esconde os números e explica o porquê. */
  const [canSee, setCanSee] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSelf = !!user && user.id === id;

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;

    (async () => {
      try {
        const [target, friends] = await Promise.all([getProfile(id), getFriends(user.id)]);
        if (cancelled) return;
        setProfile(target);

        // As RPCs respeitam a RLS e devolveriam vazio para quem não é amigo —
        // sem esta checagem a tela mostraria "0 min" como se a pessoa nunca
        // tivesse assistido nada.
        const allowed = isSelf || friends.some((f) => f.id === id);
        setCanSee(allowed);
        if (!allowed) return;

        const [episodeCounts, movieWatches, myCounts] = await Promise.all([
          getFriendsEpisodeCounts([id], null),
          getFriendsMovieWatches([id], null),
          // No próprio perfil "em comum" não faz sentido — seria a lista toda.
          isSelf ? Promise.resolve([]) : getWatchedCounts(),
        ]);

        const shows = await Promise.all(
          episodeCounts.map(async (count) => {
            try {
              const details = await getShowDetailsCached(count.tmdb_show_id);
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: details.name,
                poster_path: details.poster_path,
                episodes: count.episode_count,
                minutes: count.episode_count * episodeRuntime(details),
              };
            } catch {
              return {
                tmdb_show_id: count.tmdb_show_id,
                name: t('userProfile.showFallback', { id: count.tmdb_show_id }),
                poster_path: null,
                episodes: count.episode_count,
                minutes: count.episode_count * FALLBACK_RUNTIME_MIN,
              };
            }
          })
        );

        const movieMinutes = (
          await Promise.all(
            movieWatches.map(async (movie) => {
              try {
                const details = await getMovieDetailsCached(movie.tmdb_id);
                return details.runtime || FALLBACK_MOVIE_RUNTIME_MIN;
              } catch {
                return FALLBACK_MOVIE_RUNTIME_MIN;
              }
            })
          )
        ).reduce((acc, minutes) => acc + minutes, 0);

        if (cancelled) return;
        shows.sort((a, b) => b.minutes - a.minutes);

        // Interseção com o que eu assisto. Sai de graça: as séries em comum
        // são um subconjunto das do amigo, já resolvidas na TMDB acima.
        const myEpisodesByShow = new Map(myCounts.map((c) => [c.tmdb_show_id, c.episode_count]));
        const common = shows
          .filter((show) => myEpisodesByShow.has(show.tmdb_show_id))
          .map((show) => ({ ...show, myEpisodes: myEpisodesByShow.get(show.tmdb_show_id)! }));

        setStats({
          totalMinutes: shows.reduce((acc, show) => acc + show.minutes, 0) + movieMinutes,
          totalEpisodes: shows.reduce((acc, show) => acc + show.episodes, 0),
          totalShows: shows.length,
          totalMovies: movieWatches.length,
          shows: shows.slice(0, TOP_SHOWS),
          common,
        });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, t('userProfile.statsError')));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, id, isSelf]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (canSee === null || (canSee && !stats)) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const name = profile ? profileDisplayName(profile) : '…';

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement }]}>
        <UserAvatar avatarId={profile?.avatar_id ?? null} name={name} size={64} />
        <ThemedText type="subtitle">{name}</ThemedText>
        {profile && (
          <ThemedText type="small" themeColor="textSecondary">
            @{profile.username}
          </ThemedText>
        )}
      </View>

      {!canSee ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={36} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {t('userProfile.visibleOnlyToFriends', { name })}
          </ThemedText>
        </View>
      ) : (
        stats && <StatsBody stats={stats} name={name} />
      )}
    </ScrollView>
  );
}

function StatsBody({ stats, name }: { stats: UserStats; name: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const duration = formatDuration(stats.totalMinutes);

  return (
    <>
      <View style={[styles.heroCard, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('userProfile.totalWatchTime')}
        </ThemedText>
        <View style={styles.durationRow}>
          {duration.months > 0 && (
            <Block value={duration.months} label={t('userProfile.months', { count: duration.months })} />
          )}
          <Block value={duration.days} label={t('userProfile.days', { count: duration.days })} />
          <Block value={duration.hours} label={t('userProfile.hours')} />
          <Block value={duration.minutes} label={t('userProfile.minutesShort')} />
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatCard value={stats.totalEpisodes} label={t('userProfile.episodesLabel')} />
        <StatCard value={stats.totalShows} label={t('userProfile.showsLabel')} />
        <StatCard value={stats.totalMovies} label={t('userProfile.moviesLabel')} />
      </View>

      {stats.common.length > 0 && (
        <View style={styles.commonSection}>
          <ThemedText type="smallBold" style={styles.commonSectionTitle}>
            {t('userProfile.commonShowsHeader', {
              count: stats.common.length.toLocaleString(i18n.language),
            })}
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.commonRow}>
            {stats.common.map((show) => (
              <CommonShowCard key={show.tmdb_show_id} show={show} friendName={name} />
            ))}
          </ScrollView>
        </View>
      )}

      {stats.shows.length > 0 && (
        <>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            {t('userProfile.mostWatchedShows')}
          </ThemedText>
          {stats.shows.map((show) => (
            <ShowRow
              key={show.tmdb_show_id}
              show={show}
              subtitle={`${t('userProfile.episodesCount', { count: show.episodes })} · ${shortDuration(show.minutes)}`}
            />
          ))}
        </>
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        {t('userProfile.note')}
      </ThemedText>
    </>
  );
}

/** Linha de série com pôster e uma legenda livre; leva à tela da série. */
function ShowRow({ show, subtitle }: { show: ShowStat; subtitle: string }) {
  const theme = useTheme();
  const poster = posterUrl(show.poster_path, 'w185');
  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_show_id) } }} asChild>
      {/* Link asChild perde estilos em array — flatten é obrigatório aqui. */}
      <Pressable
        style={StyleSheet.flatten([styles.showRow, { backgroundColor: theme.backgroundElement }])}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.showInfo}>
          <View style={styles.showName}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={{ color: theme.accent, flexShrink: 1 }}>
              {show.name}
            </ThemedText>
            <Ionicons name="chevron-forward" size={12} color={theme.accent} />
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>
      </Pressable>
    </Link>
  );
}

/** Card do carrossel de séries em comum: pôster grande + comparação dos dois lados embaixo. */
function CommonShowCard({ show, friendName }: { show: CommonShow; friendName: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const poster = posterUrl(show.poster_path, 'w185');
  return (
    <Link href={{ pathname: '/show/[id]', params: { id: String(show.tmdb_show_id) } }} asChild>
      <Pressable style={styles.commonCard}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.commonPoster} contentFit="cover" />
        ) : (
          <View style={[styles.commonPoster, { backgroundColor: theme.backgroundElement }]} />
        )}
        <ThemedText type="smallBold" numberOfLines={2}>
          {show.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {t('userProfile.youEpisodes', { count: show.myEpisodes.toLocaleString(i18n.language) })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {t('userProfile.friendEpisodes', {
            name: friendName,
            count: show.episodes.toLocaleString(i18n.language),
          })}
        </ThemedText>
      </Pressable>
    </Link>
  );
}

function Block({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.durationBlock}>
      <ThemedText type="subtitle" style={{ color: theme.gold }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText
        type="subtitle"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ color: theme.gold }}>
        {value.toLocaleString(i18n.language)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
    flex: 1,
  },
  message: {
    textAlign: 'center',
  },
  header: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  heroCard: {
    borderRadius: 12,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
  },
  durationRow: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  durationBlock: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  commonSection: {
    marginTop: Spacing.two,
    gap: Spacing.two,
    // O carrossel rola dentro do padding da tela; sem isso as bordas dos
    // cards ficariam grudadas na tela em vez de alinhadas com o resto.
    marginHorizontal: -Spacing.three,
  },
  commonSectionTitle: {
    marginHorizontal: Spacing.three,
  },
  commonRow: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  commonCard: {
    width: 110,
    gap: Spacing.half,
  },
  commonPoster: {
    width: 110,
    height: 165,
    borderRadius: 8,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  poster: {
    width: 44,
    height: 66,
    borderRadius: 8,
  },
  showInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  showName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: '100%',
  },
  note: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
});
