import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { profileDisplayName } from '@/lib/db';
import { getQuizLeaderboard, type QuizLeaderboardEntry } from '@/lib/quiz';

const MEDALS = ['🥇', '🥈', '🥉'];

// Mostra ~10 linhas; o resto fica atrás de um scroll interno no próprio card.
const ROW_HEIGHT = 41;
const VISIBLE_ROWS = 10;

/**
 * Placar de escaladas do usuário + amigos, mostrado abaixo do resultado do
 * quiz. Recarrega toda vez que monta (ex.: reabrir o quiz pelo perfil), então
 * reflete o que os amigos fizeram nesse meio-tempo. Some se der erro.
 */
export function QuizLeaderboard() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [entries, setEntries] = useState<QuizLeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    getQuizLeaderboard(user.id)
      .then((next) => {
        setEntries(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [user]);

  if (failed) return null;

  if (!entries) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <Pressable
        style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push('/friends')}>
        <Ionicons name="people-outline" size={18} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          {t('quiz.screen.leaderboardEmpty')}
        </ThemedText>
        <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
        {t('quiz.screen.leaderboardTitle')}
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ScrollView
          style={entries.length > VISIBLE_ROWS && { maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
          nestedScrollEnabled
          bounces={false}
          showsVerticalScrollIndicator={entries.length > VISIBLE_ROWS}>
          {entries.map((entry, index) => (
            <View
              key={entry.user.id}
              style={[
                styles.row,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.background,
                },
                entry.isMe && { backgroundColor: theme.accent + '26' },
              ]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.rank}>
                {MEDALS[index] ?? index + 1}
              </ThemedText>
              <UserAvatar
                avatarId={entry.user.avatar_id}
                name={profileDisplayName(entry.user)}
                size={24}
              />
              <ThemedText
                type={entry.isMe ? 'smallBold' : 'small'}
                numberOfLines={1}
                style={[styles.name, entry.isMe && { color: theme.accent }]}>
                {entry.isMe ? t('quiz.screen.leaderboardYou') : profileDisplayName(entry.user)}
              </ThemedText>
              {entry.answeredToday && (
                <Ionicons name="checkmark-circle" size={14} color={theme.accent} />
              )}
              <View style={styles.statCol}>
                <Ionicons name="trophy" size={12} color={theme.gold} />
                <ThemedText type="smallBold" style={styles.statColText}>
                  {entry.totalScore}
                </ThemedText>
              </View>
              <View style={styles.statCol}>
                <Ionicons name="flame" size={12} color={theme.gold} />
                <ThemedText type="smallBold" style={styles.statColText}>
                  {entry.currentStreak}
                </ThemedText>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  loading: {
    marginTop: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  title: {
    marginLeft: Spacing.one,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rank: {
    width: 22,
    textAlign: 'center',
  },
  name: {
    flex: 1,
  },
  statCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 28,
    justifyContent: 'flex-end',
  },
  statColText: {
    fontSize: 13,
  },
  emptyCard: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  emptyText: {
    flex: 1,
  },
});
