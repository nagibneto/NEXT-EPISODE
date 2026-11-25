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
import { formatXboxDevice, getXboxGameStats, type XboxGameStats } from '@/lib/xbox';

const LATEST_SHOWN = 4;
/** Verde do Xbox — só no ícone da marca e na barra, como as cores dos troféus. */
const XBOX_GREEN = '#107C10';

/**
 * Card "No seu Xbox" da tela do jogo: conquistas e Gamerscore da gamertag
 * vinculada. O jogo é achado pelo nome (o Xbox não tem id em comum com a
 * IGDB). Some quando o jogo não está no histórico; sem Xbox vinculado, vira
 * um convite discreto.
 */
export function XboxGameCard({ gameName }: { gameName: string }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  // undefined = carregando; null = sem Xbox vinculado.
  const [xuid, setXuid] = useState<string | null | undefined>(undefined);
  const [stats, setStats] = useState<XboxGameStats | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getLinkedGameAccount(user.id, 'xbox')
      .then((account) => {
        if (cancelled) return;
        setXuid(account?.account_id ?? null);
        if (!account) return;
        return getXboxGameStats(account.account_id, gameName, i18n.language).then((result) => {
          if (!cancelled) setStats(result);
        });
      })
      .catch(() => {
        // API não oficial fora do ar não pode quebrar a tela: o card some.
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, gameName, i18n.language]);

  if (xuid === undefined) return null;

  if (xuid === null) {
    return (
      <Pressable
        style={[styles.invite, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/game-accounts')}>
        <Ionicons name="logo-xbox" size={18} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
          {t('games.xbox.invite')}
        </ThemedText>
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  }

  if (!stats || (!stats.private && !stats.owned)) return null;

  const header = (extra?: string) => (
    <View style={styles.titleRow}>
      <Ionicons name="logo-xbox" size={18} color={XBOX_GREEN} />
      <ThemedText type="smallBold" style={styles.flex}>
        {t('games.xbox.cardTitle')}
      </ThemedText>
      {extra ? (
        <ThemedText type="small" themeColor="textSecondary">
          {extra}
        </ThemedText>
      ) : null}
    </View>
  );

  if (stats.private) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {header()}
        <ThemedText type="small" themeColor="textSecondary">
          {t('games.xbox.cardPrivate')}
        </ThemedText>
      </View>
    );
  }

  const devices = [...new Set(stats.devices.map(formatXboxDevice))].join(' · ');
  const ach = stats.achievements;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      {header(devices)}

      {stats.lastPlayed ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('games.xbox.lastPlayed', {
            date: formatDate(stats.lastPlayed, { day: 'numeric', month: 'short', year: 'numeric' }),
          })}
        </ThemedText>
      ) : null}

      {ach && ach.total > 0 && (
        <>
          <View style={styles.progressHeader}>
            <Ionicons name="trophy" size={14} color={theme.gold} />
            <ThemedText type="smallBold">
              {t('games.xbox.achievements', { unlocked: ach.unlocked, total: ach.total })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('games.xbox.gamerscore', { score: ach.gamerscore, total: ach.totalGamerscore })}
            </ThemedText>
          </View>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: XBOX_GREEN,
                  width: `${Math.min(100, Math.round((ach.unlocked / ach.total) * 100))}%`,
                },
              ]}
            />
          </View>
        </>
      )}

      {stats.latest.slice(0, LATEST_SHOWN).map((achievement) => (
        <View key={`${achievement.name}-${achievement.unlockedAt}`} style={styles.achievement}>
          {achievement.icon ? (
            <Image source={{ uri: achievement.icon }} style={styles.icon} contentFit="cover" />
          ) : (
            <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]} />
          )}
          <View style={styles.flex}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.achievementName}>
              {achievement.name}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.achievementDesc}>
              {[
                achievement.gamerscore > 0 ? `${achievement.gamerscore} G` : null,
                achievement.unlockedAt
                  ? formatDate(achievement.unlockedAt, { day: 'numeric', month: 'short' })
                  : null,
                achievement.description,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>
        </View>
      ))}
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
