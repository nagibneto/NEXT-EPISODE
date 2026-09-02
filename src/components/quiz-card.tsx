import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { getQuizState, type QuizState } from '@/lib/quiz';

/**
 * Card do Quiz do dia no perfil: dias seguidos de acerto (número em amarelo do
 * logo) e atalho para a tela do quiz. O ícone à direita mostra se a pergunta
 * de hoje já foi respondida (mesmo padrão dos episódios assistidos).
 * Some silenciosamente se a consulta falhar (feature acessória).
 */
export function QuizCard() {
  const theme = useTheme();
  const { t } = useTranslation();
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

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}
      onPress={() => router.push('/quiz')}>
      <ThemedText style={[styles.count, { color: theme.gold }]}>{streak}</ThemedText>

      <View style={styles.info}>
        <ThemedText type="smallBold">{t('quiz.card.title')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('quiz.card.subtitle')}
        </ThemedText>
      </View>

      <Ionicons
        name={answeredToday ? 'checkmark-circle' : 'checkmark-circle-outline'}
        size={24}
        color={answeredToday ? theme.accent : theme.textSecondary}
      />
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  count: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    minWidth: 26,
    textAlign: 'center',
  },
  info: {
    flex: 1,
    gap: 1,
  },
});
