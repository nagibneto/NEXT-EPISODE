import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { CURRENT_ANNOUNCEMENT, INSTAGRAM_HANDLE } from '@/lib/announcements';
import { hasSeenCampaign, markCampaignSeen } from '@/lib/db';
import { acquireStartupPrompt, releaseStartupPrompt } from '@/lib/startup-prompts';

// Uma tentativa por sessão: se a marcação no banco falhar (sem rede), o aviso
// volta na próxima abertura em vez de insistir na mesma.
let checkedThisSession = false;

/**
 * Banner de aviso único, no mesmo formato do modal do quiz: aparece uma vez ao
 * abrir o app e nunca mais, seja qual for o botão escolhido. O conteúdo é a
 * campanha atual (ver src/lib/announcements.ts) e o "nunca mais" mora em
 * campaign_deliveries, então vale para todos os aparelhos da mesma conta.
 */
export function AnnouncementPrompt() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (checkedThisSession) return;
    let cancelled = false;

    (async () => {
      try {
        if (await hasSeenCampaign(user.id, CURRENT_ANNOUNCEMENT.key)) {
          checkedThisSession = true;
          return;
        }
        if (cancelled) return;

        // Marca antes de mostrar, de propósito: assim "apareceu uma vez" fica
        // registrado mesmo que o app seja fechado com o banner na tela. Se a
        // gravação falhar (sem rede), nada aparece e tentamos na próxima
        // abertura — melhor atrasar o aviso do que arriscar repeti-lo.
        await markCampaignSeen(user.id, CURRENT_ANNOUNCEMENT.key);
        checkedThisSession = true;
        if (cancelled) return;

        // Espera a vez: o modal do quiz pode estar na tela.
        await acquireStartupPrompt();
        if (cancelled) {
          releaseStartupPrompt();
          return;
        }
        setVisible(true);
      } catch {
        // Sem rede / falha na consulta: tenta de novo na próxima abertura.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function close() {
    setVisible(false);
    releaseStartupPrompt();
  }

  function openAction() {
    close();
    CURRENT_ANNOUNCEMENT.action().catch(() => {});
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.emoji}>{CURRENT_ANNOUNCEMENT.emoji}</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {t(`${CURRENT_ANNOUNCEMENT.i18nKey}.title`)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {t(`${CURRENT_ANNOUNCEMENT.i18nKey}.subtitle`, { handle: INSTAGRAM_HANDLE })}
          </ThemedText>

          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.accent }]}
            onPress={openAction}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t(`${CURRENT_ANNOUNCEMENT.i18nKey}.action`)}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.laterButton} onPress={close}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t(`${CURRENT_ANNOUNCEMENT.i18nKey}.later`)}
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
