import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { scheduleDailyQuizNotification } from '@/lib/notifications';
import { getQuizState } from '@/lib/quiz';

// Uma vez por sessão do app: reabrir depois de fechar mostra de novo (enquanto
// não respondeu), mas trocar de aba/voltar de background não fica repetindo.
let promptShownThisSession = false;

/**
 * Modal "o quiz de hoje chegou", mostrado ao abrir o app enquanto o usuário
 * ainda não respondeu a pergunta do dia. Fica montado no layout das abas e
 * também (re)agenda a notificação diária do quiz a cada abertura.
 */
export function QuizDayPrompt() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  // Já tinha escalada antes de hoje? Muda o texto entre "inicie" e "mantenha".
  const [hasStreak, setHasStreak] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    scheduleDailyQuizNotification(user.id).catch(() => {});

    if (promptShownThisSession) return;

    (async () => {
      try {
        const state = await getQuizState(user.id);
        if (cancelled || state.today || !state.question || promptShownThisSession) return;
        promptShownThisSession = true;
        setHasStreak(state.currentStreak > 0);
        setVisible(true);
      } catch {
        // Sem rede / falha na consulta: sem modal, o card do perfil ainda leva ao quiz.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function close() {
    setVisible(false);
  }

  function answerNow() {
    setVisible(false);
    router.push('/quiz');
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.emoji}>🎬</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {t('quiz.modal.title')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {t('quiz.modal.subtitlePrefix')}{' '}
            {hasStreak ? t('quiz.modal.subtitleContinue') : t('quiz.modal.subtitleStart')}
          </ThemedText>

          <Pressable
            style={[styles.answerButton, { backgroundColor: theme.accent }]}
            onPress={answerNow}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('quiz.modal.answer')}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.laterButton} onPress={close}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('quiz.modal.later')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 36,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  answerButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  laterButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
