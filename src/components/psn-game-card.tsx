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
import { getPsnGameStats, type PsnGameStats, type TrophyCounts } from '@/lib/psn';

const LATEST_SHOWN = 4;

/** Cores clássicas dos troféus (iguais nos dois temas, como o amarelo do app). */
const TROPHY_COLORS: Record<keyof TrophyCounts, string> = {
  platinum: '#9FB7D0',
  gold: '#E2B33C',
  silver: '#B7BCC2',
  bronze: '#C07A45',
};
const TROPHY_ORDER: readonly (keyof TrophyCounts)[] = ['platinum', 'gold', 'silver', 'bronze'];

/**
 * Card "Na sua PlayStation" da tela do jogo: progresso de troféus da conta
 * PSN vinculada. O jogo é achado pelo nome (a PSN não tem id em comum com a
 * IGDB). Some quando o jogo não está na conta; sem PSN vinculada, vira um
 * convite discreto.
 */
export function PsnGameCard({ gameName }: { gameName: string }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  // undefined = carregando; null = sem PSN vinculada.
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [stats, setStats] = useState<PsnGameStats | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getLinkedGameAccount(user.id, 'psn')
      .then((account) => {
        if (cancelled) return;
        setAccountId(account?.account_id ?? null);
        if (!account) return;
        return getPsnGameStats(account.account_id, gameName, i18n.language).then((result) => {
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

  if (accountId === undefined) return null;

  if (accountId === null) {
    return (
      <Pressable
        style={[styles.invite, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/game-accounts')}>
        <Ionicons name="logo-playstation" size={18} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
          {t('games.psn.invite')}
        </ThemedText>
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  }

  if (!stats || (!stats.private && !stats.owned)) return null;

  if (stats.private) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.titleRow}>
          <Ionicons name="logo-playstation" size={18} color={theme.text} />
          <ThemedText type="smallBold">{t('games.psn.cardTitle')}</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('games.psn.cardPrivate')}
        </ThemedText>
      </View>
    );
  }

  const earnedTotal = TROPHY_ORDER.reduce((sum, type) => sum + stats.earned[type], 0);
  const definedTotal = TROPHY_ORDER.reduce((sum, type) => sum + stats.defined[type], 0);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.titleRow}>
        <Ionicons name="logo-playstation" size={18} color={theme.text} />
        <ThemedText type="smallBold" style={styles.flex}>
          {t('games.psn.cardTitle')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {stats.platform.replace(',', ' · ')}
        </ThemedText>
      </View>

      <View style={styles.progressHeader}>
        <ThemedText type="smallBold">
          {t('games.psn.trophies', { earned: earnedTotal, total: definedTotal })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {stats.progress}%
        </ThemedText>
        {stats.earned.platinum > 0 && (
          <ThemedText type="smallBold" style={{ color: TROPHY_COLORS.platinum }}>
            {t('games.psn.platinumEarned')}
          </ThemedText>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[styles.fill, { backgroundColor: theme.accent, width: `${stats.progress}%` }]}
        />
      </View>

      {/* Contagem por tipo: platina · ouro · prata · bronze. */}
      <View style={styles.countsRow}>
        {TROPHY_ORDER.filter((type) => stats.defined[type] > 0).map((type) => (
          <View key={type} style={styles.count}>
            <Ionicons name="trophy" size={14} color={TROPHY_COLORS[type]} />
            <ThemedText type="small">
              {stats.earned[type]}/{stats.defined[type]}
            </ThemedText>
          </View>
        ))}
      </View>

      {stats.latest.slice(0, LATEST_SHOWN).map((trophy) => (
        <View key={`${trophy.name}-${trophy.earnedAt}`} style={styles.trophy}>
          {trophy.icon ? (
            <Image source={{ uri: trophy.icon }} style={styles.icon} />
          ) : (
            <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]} />
          )}
          <View style={styles.flex}>
            <View style={styles.trophyNameRow}>
              <Ionicons name="trophy" size={11} color={TROPHY_COLORS[trophy.type]} />
              <ThemedText type="smallBold" numberOfLines={1} style={styles.trophyName}>
                {trophy.name}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.trophyDesc}>
              {formatDate(trophy.earnedAt, { day: 'numeric', month: 'short', year: 'numeric' })}
              {trophy.description ? ` · ${trophy.description}` : ''}
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
  countsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trophy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  trophyNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trophyName: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  trophyDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
});
