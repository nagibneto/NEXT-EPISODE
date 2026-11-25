import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { getLinkedGameAccount } from '@/lib/db';
import { formatDate } from '@/lib/locale';
import { formatPlaytime, getSteamGameStats, type SteamGameStats } from '@/lib/steam';

/** Quantas conquistas recentes aparecem com nome (o resto fica só na contagem). */
const LATEST_SHOWN = 4;

/**
 * Card "Na sua Steam" da tela do jogo: horas jogadas e conquistas, lidas do
 * perfil público vinculado em Contas de games. Some quando o jogo não está
 * na conta; sem conta vinculada, vira um convite discreto para vincular.
 */
export function SteamGameCard({ appId }: { appId: number }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  // undefined = carregando; null = sem Steam vinculada.
  const [steamId, setSteamId] = useState<string | null | undefined>(undefined);
  const [stats, setStats] = useState<SteamGameStats | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getLinkedGameAccount(user.id, 'steam')
      .then((account) => {
        if (cancelled) return;
        setSteamId(account?.account_id ?? null);
        if (!account) return;
        return getSteamGameStats(account.account_id, appId, i18n.language).then((result) => {
          if (!cancelled) setStats(result);
        });
      })
      .catch(() => {
        // Steam fora do ar não pode quebrar a tela do jogo: o card some.
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, appId, i18n.language]);

  if (steamId === undefined) return null;

  if (steamId === null) {
    return (
      <Pressable
        style={[styles.invite, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/game-accounts')}>
        <Ionicons name="logo-steam" size={18} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
          {t('games.steam.invite')}
        </ThemedText>
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  }

  if (!stats || (!stats.private && !stats.owned)) return null;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.titleRow}>
        <Ionicons name="logo-steam" size={18} color={theme.text} />
        <ThemedText type="smallBold">{t('games.steam.cardTitle')}</ThemedText>
      </View>

      {stats.private ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('games.steam.cardPrivate')}
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {[
              t('games.steam.played', { time: formatPlaytime(stats.playtimeMinutes) }),
              stats.lastPlayed
                ? t('games.steam.lastPlayed', {
                    date: formatDate(new Date(stats.lastPlayed * 1000).toISOString(), {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>

          {stats.achievements && (
            <>
              <View style={styles.progressHeader}>
                <Ionicons name="trophy" size={14} color={theme.gold} />
                <ThemedText type="smallBold">
                  {t('games.steam.achievements', {
                    unlocked: stats.achievements.unlocked,
                    total: stats.achievements.total,
                  })}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {Math.round((stats.achievements.unlocked / stats.achievements.total) * 100)}%
                </ThemedText>
              </View>
              <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: theme.gold,
                      width: `${(stats.achievements.unlocked / stats.achievements.total) * 100}%`,
                    },
                  ]}
                />
              </View>
              {stats.achievements.latest.slice(0, LATEST_SHOWN).map((achievement) => (
                <View key={`${achievement.name}-${achievement.unlockedAt}`} style={styles.achievement}>
                  {achievement.icon ? (
                    <Image source={{ uri: achievement.icon }} style={styles.icon} />
                  ) : (
                    <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]} />
                  )}
                  <View style={styles.flex}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.achievementName}>
                      {achievement.name}
                    </ThemedText>
                    {achievement.description ? (
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={1}
                        style={styles.achievementDesc}>
                        {achievement.description}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  flex: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  achievement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  achievementName: {
    fontSize: 13,
    lineHeight: 17,
  },
  achievementDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
});
