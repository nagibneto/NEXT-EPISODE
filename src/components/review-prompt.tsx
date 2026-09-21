import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  markReviewAsked,
  markReviewDone,
  REVIEW_PROMPT_ENABLED,
  shouldAskForReview,
} from '@/lib/app-review';
import { pendingUpdateOnce, UPDATE_PROMPT_ENABLED } from '@/lib/app-update';
import { acquireStartupPrompt, releaseStartupPrompt } from '@/lib/startup-prompts';
import { openStoreReview } from '@/lib/store-links';

// Uma verificação por sessão, como os outros avisos de abertura.
let checkedThisSession = false;

/**
 * Modal "está curtindo o app? deixe uma nota".
 *
 * Quando perguntar é decisão de src/lib/app-review.ts — aqui só tem a tela e
 * o registro do que a pessoa respondeu. Entra na fila dos avisos de abertura,
 * então nunca aparece junto do quiz ou do aviso de atualização.
 *
 * Os dois botões fecham para sempre o assunto de formas diferentes: "avaliar"
 * encerra de vez, "agora não" adia (e depois de MAX_ASKS recusas a gente para
 * de perguntar).
 */
export function ReviewPrompt() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!REVIEW_PROMPT_ENABLED) return;
    if (checkedThisSession) return;
    checkedThisSession = true;
    let cancelled = false;

    (async () => {
      if (!(await shouldAskForReview())) return;
      // Nada de pedir nota para quem está numa versão velha — e muito menos
      // na mesma abertura em que o outro modal pede para atualizar.
      if (UPDATE_PROMPT_ENABLED && (await pendingUpdateOnce())) return;
      if (cancelled) return;

      // Espera a vez na fila dos avisos de abertura (o modal do quiz pode
      // estar na tela).
      await acquireStartupPrompt();
      if (cancelled) {
        releaseStartupPrompt();
        return;
      }
      // Conta a tentativa ao mostrar, não ao responder: fechar o app com o
      // modal na tela também é uma resposta.
      await markReviewAsked();
      setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function close() {
    setVisible(false);
    releaseStartupPrompt();
  }

  function rate() {
    close();
    markReviewDone();
    openStoreReview().catch(() => {});
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.emoji}>⭐</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {t('review.title')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {t('review.subtitle')}
          </ThemedText>

          <Pressable style={[styles.actionButton, { backgroundColor: theme.accent }]} onPress={rate}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('review.action')}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.laterButton} onPress={close}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('review.later')}
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
  actionButton: {
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
