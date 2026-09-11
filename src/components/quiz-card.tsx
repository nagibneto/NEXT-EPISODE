import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getQuizState, type QuizState, type QuizWeekDay } from '@/lib/quiz';

/** Diâmetro das bolinhas da semana; a linha que as conecta usa a metade disso. */
const DOT_SIZE = 26;

/** "seg." → "Seg" no idioma ativo, sem precisar de chave de tradução por dia. */
function weekdayLabel(date: string, language: string): string {
  const label = new Date(`${date}T00:00:00`)
    .toLocaleDateString(language, { weekday: 'short' })
    .replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Card do Quiz do dia no perfil: chama, mostra a escalada (dias seguidos de
 * acerto) e a semana em bolinhas — verde/azul no acerto, apagada no erro ou no
 * dia não respondido. Some silenciosamente se a consulta falhar (acessório).
 */
export function QuizCard() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [state, setState] = useState<QuizState | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      getQuizState(user.id)
        .then((next) => {
          setState(next);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, [user])
  );

  if (failed) return null;

  const streak = state?.currentStreak ?? 0;
  const answeredToday = state?.today != null;
  const week = state?.week ?? [];

  /** Cor de fundo da bolinha do dia: acerto destaca, o resto fica discreto. */
  function dotBackground(day: QuizWeekDay): string {
    if (day.correct) return theme.accent;
    if (day.answered) return theme.danger;
    return theme.backgroundSelected;
  }

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}
      onPress={() => router.push('/quiz')}>
      <View style={styles.headerRow}>
        <ThemedText style={styles.flame}>🔥</ThemedText>
        <View style={styles.info}>
          <ThemedText type="smallBold">{t('quiz.card.title')}</ThemedText>
          <ThemedText type="smallBold" style={[styles.streak, { color: theme.goldText }]}>
            {t('quiz.card.streakDays', { count: streak })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('quiz.card.subtitle')}
          </ThemedText>
        </View>
        <View
          style={[
            styles.pill,
            {
              backgroundColor: answeredToday ? theme.backgroundSelected : theme.accent,
            },
          ]}>
          <Ionicons
            name={answeredToday ? 'checkmark-circle' : 'play-circle'}
            size={16}
            color={answeredToday ? theme.accent : theme.accentText}
          />
          <ThemedText
            type="small"
            numberOfLines={1}
            style={{ color: answeredToday ? theme.accent : theme.accentText }}>
            {answeredToday ? t('quiz.card.doneToday') : t('quiz.card.playNow')}
          </ThemedText>
        </View>
      </View>

      {week.length > 0 && (
        <View style={styles.week}>
          {/* Linha que liga as bolinhas, atrás delas (recuada meia coluna de cada lado). */}
          <View
            style={[
              styles.weekLine,
              { backgroundColor: theme.backgroundSelected, top: DOT_SIZE / 2 - 1 },
            ]}
          />
          {week.map((day) => (
            <View key={day.date} style={styles.weekDay}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dotBackground(day), opacity: day.future ? 0.4 : 1 },
                ]}>
                {day.answered && (
                  <Ionicons
                    name={day.correct ? 'checkmark' : 'close'}
                    size={15}
                    color={theme.accentText}
                  />
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.weekLabel}>
                {weekdayLabel(day.date, i18n.language)}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flame: {
    fontSize: 30,
    lineHeight: 38,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  streak: {
    fontSize: 17,
    lineHeight: 22,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    flexShrink: 1,
  },
  week: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekLine: {
    position: 'absolute',
    // ~meia coluna de cada lado, para a linha começar e terminar nas bolinhas.
    left: '7%',
    right: '7%',
    height: 2,
  },
  weekDay: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
});
