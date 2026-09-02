import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ConfettiBurst } from '@/components/confetti-burst';
import { QuizLeaderboard } from '@/components/quiz-leaderboard';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/db';
import { getQuizState, submitQuizAnswer, type QuizAnswer, type QuizState } from '@/lib/quiz';

// Verde do "acertou" — o tema não tem essa cor e ela funciona sobre os dois fundos.
const CORRECT_COLOR = '#22C55E';
// Paleta do confete quando erra: tons mais frios/avermelhados.
const WRONG_CONFETTI_COLORS = ['#F28B82', '#D93025', '#B0B4BA', '#6E7178', '#F5A623'];

export default function QuizScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [state, setState] = useState<QuizState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justAnswered, setJustAnswered] = useState<QuizAnswer | null>(null);
  // Incrementa a cada acerto novo (não em resposta antiga já carregada) para
  // disparar uma nova leva de confete — ver ConfettiBurst.
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  useEffect(() => {
    if (!user) return;
    getQuizState(user.id)
      .then(setState)
      .catch((err) => setError(errorMessage(err, t('quiz.screen.loadError'))));
  }, [user, t]);

  if (!user) return <Redirect href="/login" />;

  if (error && !state) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="danger" style={styles.centerText}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (!state) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          {t('quiz.screen.loading')}
        </ThemedText>
      </View>
    );
  }

  if (!state.question) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Ionicons name="sparkles-outline" size={28} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          {t('quiz.screen.noQuizToday')}
        </ThemedText>
      </View>
    );
  }

  const question = state.question;
  const answer = justAnswered ?? state.today;
  const answered = answer !== null;

  async function handleSubmit() {
    if (selected === null || !user || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await submitQuizAnswer(user.id, state!.quizDate, question, selected);
      setJustAnswered(saved);
      setConfettiTrigger((n) => n + 1);
      // Recarrega o streak já contando a resposta de agora.
      getQuizState(user.id)
        .then(setState)
        .catch(() => {});
    } catch (err) {
      setError(errorMessage(err, t('quiz.screen.submitError')));
    } finally {
      setSubmitting(false);
    }
  }

  function optionStyle(index: number) {
    // Antes de responder: só destaca a opção escolhida.
    if (!answered) {
      return index === selected
        ? { borderColor: theme.accent, backgroundColor: theme.backgroundSelected }
        : { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement };
    }
    // Depois de responder: verde na certa, vermelho na errada que o usuário marcou.
    if (index === question.correctIndex) {
      return { borderColor: CORRECT_COLOR, backgroundColor: CORRECT_COLOR + '22' };
    }
    if (index === answer!.selected_index) {
      return { borderColor: theme.danger, backgroundColor: theme.danger + '22' };
    }
    return { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement };
  }

  function optionIcon(index: number): keyof typeof Ionicons.glyphMap | null {
    if (!answered) return null;
    if (index === question.correctIndex) return 'checkmark-circle';
    if (index === answer!.selected_index) return 'close-circle';
    return null;
  }

  const showStats = state.totalScore > 0 || state.currentStreak > 0 || state.bestStreak > 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showStats && (
          <View style={[styles.statsCard, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>{state.totalScore}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
                {t('quiz.screen.statScore')}
              </ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.background }]} />
            <View style={styles.statItem}>
              <ThemedText style={[styles.statValue, { color: theme.gold }]}>
                {state.currentStreak}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
                {t('quiz.screen.statStreak')}
              </ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.background }]} />
            <View style={styles.statItem}>
              <ThemedText style={[styles.statValue, { color: theme.textSecondary }]}>
                {state.bestStreak}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
                {t('quiz.screen.statBest')}
              </ThemedText>
            </View>
          </View>
        )}

        <ThemedText style={styles.question}>{question.question}</ThemedText>

        <View style={styles.options}>
          {question.options.map((option, index) => {
            const icon = optionIcon(index);
            return (
              <Pressable
                key={index}
                disabled={answered || submitting}
                onPress={() => setSelected(index)}
                style={[styles.option, optionStyle(index)]}>
                <ThemedText style={styles.optionText}>{option}</ThemedText>
                {icon && (
                  <Ionicons
                    name={icon}
                    size={20}
                    color={index === question.correctIndex ? CORRECT_COLOR : theme.danger}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {error && (
          <ThemedText type="small" themeColor="danger" style={styles.centerText}>
            {error}
          </ThemedText>
        )}

        {!answered ? (
          <Pressable
            disabled={selected === null || submitting}
            onPress={handleSubmit}
            style={[
              styles.submit,
              { backgroundColor: theme.accent, opacity: selected === null || submitting ? 0.5 : 1 },
            ]}>
            {submitting ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                {t('quiz.screen.submit')}
              </ThemedText>
            )}
          </Pressable>
        ) : (
          <View style={[styles.resultCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText
              style={[
                styles.verdict,
                { color: answer!.is_correct ? CORRECT_COLOR : theme.danger },
              ]}>
              {answer!.is_correct ? t('quiz.screen.wellDone') : t('quiz.screen.wrongExclaim')}
            </ThemedText>
            {/* Errou? Mostra o porquê — acertou, o verde na alternativa já basta. */}
            {!answer!.is_correct && (
              <View style={styles.explanationRow}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('quiz.screen.explanationLabel')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {question.explanation}
                </ThemedText>
              </View>
            )}
            <ThemedText style={styles.tomorrowText}>
              {t('quiz.screen.comeBackTomorrowPrefix')}
              <ThemedText style={styles.tomorrowBold}>
                {t('quiz.screen.comeBackTomorrowBold')}
              </ThemedText>
            </ThemedText>
          </View>
        )}

        {answered && <QuizLeaderboard />}
      </ScrollView>
      <ConfettiBurst
        trigger={confettiTrigger}
        colors={answer && !answer.is_correct ? WRONG_CONFETTI_COLORS : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  statsCard: {
    flexDirection: 'row',
    borderRadius: 16,
    paddingVertical: Spacing.three,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
  },
  statLabel: {
    textAlign: 'center',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
  },
  question: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
  },
  options: {
    gap: Spacing.two,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 15,
  },
  resultCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  explanationRow: {
    gap: 2,
  },
  verdict: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  tomorrowText: {
    fontSize: 16,
    lineHeight: 22,
  },
  tomorrowBold: {
    fontWeight: '700',
  },
});
