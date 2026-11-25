import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';

import { CommentsScreen } from '@/components/comments-screen';
import { GAME_STATUS_ICON } from '@/components/game-card';
import { GameShelf } from '@/components/game-shelf';
import { PsnGameCard } from '@/components/psn-game-card';
import { StarRating } from '@/components/star-rating';
import { SteamGameCard } from '@/components/steam-game-card';
import { XboxGameCard } from '@/components/xbox-game-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import {
  errorMessage,
  GAME_STATUSES,
  getEpisodeAverageRating,
  getGameLibraryEntry,
  getMyEpisodeRating,
  rateEpisode,
  removeGameFromLibrary,
  setGameStatus,
  type GameStatus,
} from '@/lib/db';
import { getGameDetails, igdbImage, isUpcoming, releaseYear, type GameDetails } from '@/lib/igdb';
import { useEnabledPlatforms } from '@/lib/game-platforms';
import { formatDate } from '@/lib/locale';

/** Status que liberam os comentários: quem já pôs a mão no jogo. */
const COMMENT_UNLOCK_STATUSES: readonly GameStatus[] = ['playing', 'completed', 'played', 'dropped'];

function hoursLabel(seconds: number | null) {
  if (!seconds) return null;
  return Math.max(1, Math.round(seconds / 3600));
}

export default function GameDetailsScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = Number(id);

  // Interruptor remoto: plataforma desligada não mostra card nem convite.
  const enabledPlatforms = useEnabledPlatforms();
  const [game, setGame] = useState<GameDetails | null>(null);
  // undefined = carregando; null = fora da coleção.
  const [status, setStatus] = useState<GameStatus | null | undefined>(undefined);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [average, setAverage] = useState<{ average: number; count: number } | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);
    getGameDetails(gameId)
      .then(setGame)
      .catch((err) => setError(errorMessage(err, t('games.loadError'))));
    getEpisodeAverageRating(gameId, 0, 0, 'game')
      .then(setAverage)
      .catch(() => {});
    if (user) {
      getGameLibraryEntry(user.id, gameId)
        .then((entry) => setStatus(entry?.status ?? null))
        .catch(() => setStatus(null));
      getMyEpisodeRating(user.id, gameId, 0, 0, 'game')
        .then(setMyRating)
        .catch(() => {});
    }
    // `t` muda de identidade com o idioma; recarregar por isso não faz sentido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, user]);

  /** Toca num status: entra na coleção / troca / sai (tocando no ativo). */
  async function handleStatus(next: GameStatus) {
    if (!user || !game || status === undefined) return;
    const previous = status;
    const target = previous === next ? null : next;
    setStatus(target);
    try {
      if (target === null) {
        await removeGameFromLibrary(user.id, game.id);
      } else {
        await setGameStatus(
          user.id,
          { igdb_id: game.id, name: game.name, cover_image_id: game.coverId },
          target
        );
      }
    } catch (err) {
      setStatus(previous);
      setError(errorMessage(err, t('games.updateError')));
    }
  }

  async function handleRate(rating: number) {
    if (!user) return;
    setMyRating(rating);
    try {
      await rateEpisode(user.id, gameId, 0, 0, rating, 'game');
      setAverage(await getEpisodeAverageRating(gameId, 0, 0, 'game'));
    } catch (err) {
      setError(errorMessage(err, t('games.rateError')));
    }
  }

  if (error && !game) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!game) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  // Arte oficial primeiro (costuma ser a mais bonita); senão, a 1ª captura.
  const heroId = game.artworks[0] ?? game.screenshots[0] ?? null;
  const hero = igdbImage(heroId, 'screenshot_big');
  const cover = igdbImage(game.coverId, 'cover_big');
  const year = releaseYear(game.releaseDate);
  const upcoming = isUpcoming(game.releaseDate);
  const releaseLabel =
    upcoming && game.releaseDate
      ? t('games.releaseOn', {
          // Datas da IGDB são meia-noite UTC; sem o timeZone, no Brasil
          // apareceria o dia anterior.
          date: formatDate(new Date(game.releaseDate * 1000).toISOString(), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          }),
        })
      : null;
  const subtitle = [year, game.developers[0]].filter(Boolean).join(' · ');
  const trailer = game.videos[0] ?? null;
  // ~5 linhas na largura de um celular; abaixo disso não precisa do "Ler mais".
  const longSummary = (game.summary?.length ?? 0) > 280;
  const showEnglishNote = i18n.language.startsWith('pt') && Boolean(game.summary);
  const ttb = game.timeToBeat;
  const ttbItems = ttb
    ? (
        [
          { label: t('games.ttbHastily'), hours: hoursLabel(ttb.hastily) },
          { label: t('games.ttbNormally'), hours: hoursLabel(ttb.normally) },
          { label: t('games.ttbCompletely'), hours: hoursLabel(ttb.completely) },
        ] as const
      ).filter((item) => item.hours !== null)
    : [];
  const onPlayStation = game.platformNames.some((name) => /playstation|ps vita/i.test(name));
  const onXbox = game.platformNames.some((name) => /xbox|windows/i.test(name));
  const commentsUnlocked =
    status === undefined ? null : status !== null && COMMENT_UNLOCK_STATUSES.includes(status);

  return (
    <>
      <Stack.Screen options={{ title: game.name }} />
      <CommentsScreen
        mediaType="game"
        tmdbId={gameId}
        watched={commentsUnlocked}
        lockedText={t('games.commentsLocked')}
        header={
          <View style={styles.header}>
            {hero && <Image source={{ uri: hero }} style={styles.hero} contentFit="cover" />}

            <View style={styles.headerRow}>
              {cover ? (
                <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" />
              ) : (
                <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="game-controller-outline" size={32} color={theme.textSecondary} />
                </View>
              )}
              <View style={styles.headerText}>
                <ThemedText type="smallBold" style={styles.title}>
                  {game.name}
                </ThemedText>
                {subtitle ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {subtitle}
                  </ThemedText>
                ) : null}
                {game.genres.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {game.genres.join(' · ')}
                  </ThemedText>
                )}
                {game.rating ? (
                  <View style={styles.inlineRow}>
                    <Ionicons name="star" size={12} color={theme.gold} />
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('games.igdbRating', { rating: Math.round(game.rating) })}
                    </ThemedText>
                  </View>
                ) : null}
                {releaseLabel && (
                  <View style={[styles.releaseBadge, { borderColor: theme.goldText }]}>
                    <ThemedText type="smallBold" style={[styles.releaseText, { color: theme.goldText }]}>
                      {releaseLabel}
                    </ThemedText>
                  </View>
                )}
              </View>
            </View>

            {/* Os quatro status lado a lado; tocar no ativo tira da coleção. */}
            <View style={styles.statusRow}>
              {GAME_STATUSES.map((value) => {
                const active = status === value;
                return (
                  <Pressable
                    key={value}
                    disabled={status === undefined}
                    onPress={() => handleStatus(value)}
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: active ? theme.accent : theme.backgroundElement,
                        opacity: status === undefined ? 0.6 : 1,
                      },
                    ]}>
                    <Ionicons
                      name={GAME_STATUS_ICON[value]}
                      size={20}
                      color={active ? theme.accentText : theme.text}
                    />
                    <ThemedText
                      type="smallBold"
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={[styles.statusLabel, { color: active ? theme.accentText : theme.text }]}>
                      {t(`games.status.${value}`)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {status ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {t('games.statusHint')}
              </ThemedText>
            ) : null}

            {trailer && (
              <Pressable
                style={[styles.trailerButton, { backgroundColor: theme.backgroundElement }]}
                onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${trailer.id}`)}>
                <Ionicons name="play-circle" size={20} color={theme.danger} />
                <ThemedText type="smallBold">{t('games.trailer')}</ThemedText>
              </Pressable>
            )}

            {/* Horas e conquistas da Steam vinculada (só se o jogo estiver lá). */}
            {game.steamAppId && enabledPlatforms?.has('steam') ? (
              <SteamGameCard appId={game.steamAppId} />
            ) : null}
            {/* Troféus da PSN vinculada — só para jogos lançados em PlayStation. */}
            {onPlayStation && enabledPlatforms?.has('psn') ? <PsnGameCard gameName={game.name} /> : null}
            {/* Conquistas do Xbox vinculado — jogos de Xbox ou de PC (Game Pass no PC). */}
            {onXbox && enabledPlatforms?.has('xbox') ? <XboxGameCard gameName={game.name} /> : null}

            {game.platformNames.length > 0 && (
              <View style={styles.block}>
                <ThemedText type="smallBold">{t('games.platforms')}</ThemedText>
                <View style={styles.chips}>
                  {game.platformNames.map((name) => (
                    <View key={name} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="small">{name}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {game.summary ? (
              <View style={styles.block}>
                <ThemedText type="smallBold">{t('games.about')}</ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={summaryExpanded || !longSummary ? undefined : 5}>
                  {game.summary}
                </ThemedText>
                <View style={styles.summaryFooter}>
                  {showEnglishNote ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                      {t('games.summaryInEnglish')}
                    </ThemedText>
                  ) : (
                    <View />
                  )}
                  {longSummary && (
                    <Pressable hitSlop={8} onPress={() => setSummaryExpanded((v) => !v)}>
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>
                        {summaryExpanded ? t('games.readLess') : t('games.readMore')}
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : null}

            {ttbItems.length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">{t('games.timeToBeat')}</ThemedText>
                <View style={styles.ttbRow}>
                  {ttbItems.map((item) => (
                    <View key={item.label} style={styles.ttbItem}>
                      <ThemedText type="subtitle" style={styles.ttbHours}>
                        {t('games.hours', { count: item.hours ?? 0 })}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.ttbLabel}>
                        {item.label}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {game.screenshots.length > 0 && (
              <View style={[styles.block, styles.bleed]}>
                <ThemedText type="smallBold" style={styles.bleedTitle}>
                  {t('games.screenshots')}
                </ThemedText>
                <FlatList
                  horizontal
                  data={game.screenshots}
                  keyExtractor={(item) => item}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.screenshotsRow}
                  renderItem={({ item }) => (
                    <Image
                      source={{ uri: igdbImage(item, 'screenshot_med') ?? undefined }}
                      style={styles.screenshot}
                      contentFit="cover"
                      transition={150}
                    />
                  )}
                />
              </View>
            )}

            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{t('games.yourRating')}</ThemedText>
              <StarRating value={myRating} onChange={handleRate} />
              {average && average.count > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('games.communityAverage', {
                    rating: (average.average / 2).toFixed(1),
                    count: average.count,
                  })}
                </ThemedText>
              )}
            </View>

            <GameShelf title={t('games.similar')} games={game.similar} bleed={Spacing.three} />

            <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>
              {t('games.attribution')}
            </ThemedText>

            {error && <ThemedText themeColor="danger">{error}</ThemedText>}
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  header: {
    gap: Spacing.three,
  },
  hero: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  cover: {
    width: 96,
    aspectRatio: 3 / 4,
    borderRadius: 8,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  releaseBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    marginTop: Spacing.one,
  },
  releaseText: {
    fontSize: 12,
    lineHeight: 16,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statusButton: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.lg,
    paddingVertical: 10,
    paddingHorizontal: Spacing.one,
  },
  statusLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  hint: {
    marginTop: -Spacing.two,
    fontSize: 12,
    textAlign: 'center',
  },
  trailerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.lg,
    paddingVertical: 12,
  },
  block: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  summaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  note: {
    flex: 1,
    fontSize: 11,
    fontStyle: 'italic',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  ttbRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  ttbItem: {
    flex: 1,
    alignItems: 'center',
  },
  ttbHours: {
    fontSize: 22,
    lineHeight: 28,
  },
  ttbLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  // Anula o padding da lista de comentários para o carrossel correr até a
  // borda da tela, como as recomendações na tela de filme.
  bleed: {
    marginHorizontal: -Spacing.three,
  },
  bleedTitle: {
    paddingHorizontal: Spacing.three,
  },
  screenshotsRow: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  screenshot: {
    width: 260,
    aspectRatio: 16 / 9,
    borderRadius: 10,
  },
  attribution: {
    textAlign: 'center',
    fontSize: 11,
  },
});
