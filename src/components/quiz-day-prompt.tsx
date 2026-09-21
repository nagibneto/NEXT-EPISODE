import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { scheduleDailyQuizNotification } from '@/lib/notifications';
import { getQuizState } from '@/lib/quiz';
import { acquireStartupPrompt, releaseStartupPrompt } from '@/lib/startup-prompts';

// Uma vez por sessão do app: reabrir depois de fechar mostra de novo (enquanto
// não respondeu), mas trocar de aba/voltar de background não fica repetindo.
let promptShownThisSession = false;

/** Fecha o modal que já estiver na tela (registrado pelo componente montado). */
let dismissMountedPrompt: (() => void) | null = null;

// O toque na notificação pode chegar enquanto o modal ainda espera a vez na
// fila de avisos — aí não há nada para fechar, só para não abrir depois.
let skippedThisSession = false;

/**
 * Cancela o modal desta sessão: quem abriu o app tocando na notificação do
 * quiz já cai direto na tela do quiz, e o aviso "o quiz de hoje chegou" só
 * atrapalharia. Chamado por useNotificationNavigation.
 *
 * Cobre os dois tempos: o toque na abertura fria (o modal ainda nem decidiu
 * aparecer, a consulta do estado do quiz está em andamento) e o toque com o
 * app em segundo plano, quando o modal já pode estar visível.
 */
export function skipQuizDayPrompt() {
  promptShownThisSession = true;
  skippedThisSession = true;
  dismissMountedPrompt?.();
}

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
  // Espelha `visible` para o skipQuizDayPrompt, que roda fora do React e
  // precisa saber se há mesmo um modal na tela antes de liberar a fila.
  const visibleRef = useRef(false);

  useEffect(() => {
    dismissMountedPrompt = () => {
      if (!visibleRef.current) return;
      visibleRef.current = false;
      setVisible(false);
      releaseStartupPrompt();
    };
    return () => {
      dismissMountedPrompt = null;
    };
  }, []);

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
        // Espera a vez: o banner de campanha pode estar na tela (ver
        // src/lib/startup-prompts.ts).
        await acquireStartupPrompt();
        if (cancelled || skippedThisSession) {
          releaseStartupPrompt();
          return;
        }
        visibleRef.current = true;
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
    visibleRef.current = false;
    setVisible(false);
    releaseStartupPrompt();
  }

  function answerNow() {
    close();
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
