import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  isUpdatePromptSnoozed,
  pendingUpdateOnce,
  snoozeUpdatePrompt,
  UPDATE_PROMPT_ENABLED,
  type PendingUpdate,
} from '@/lib/app-update';
import { acquireStartupPrompt, releaseStartupPrompt } from '@/lib/startup-prompts';
import { openStoreListing } from '@/lib/store-links';

// Uma consulta por sessão: trocar de aba ou voltar do background não refaz a
// checagem nem traz o modal de volta depois de fechado.
let checkedThisSession = false;

/**
 * Modal "saiu uma versão nova", com o que mudou desde a versão instalada.
 *
 * As versões e as melhorias vêm da tabela app_releases (ver src/lib/app-update.ts);
 * aqui só tem a apresentação. Fica montado no layout das abas junto dos outros
 * avisos de abertura e entra na mesma fila, para não cair por cima do quiz.
 *
 * Atualização obrigatória (mandatory na tabela) tira o "agora não" e o toque
 * fora do cartão: a única saída é ir para a loja.
 */
export function UpdatePrompt() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!UPDATE_PROMPT_ENABLED) return;
    if (checkedThisSession) return;
    checkedThisSession = true;
    let cancelled = false;

    (async () => {
      const pending = await pendingUpdateOnce();
      if (!pending || cancelled) return;
      // O "agora não" não vale para atualização obrigatória.
      if (!pending.mandatory && (await isUpdatePromptSnoozed())) return;
      if (cancelled) return;

      // Espera a vez: o modal do quiz pode estar na tela.
      await acquireStartupPrompt();
      if (cancelled) {
        releaseStartupPrompt();
        return;
      }
      setUpdate(pending);
      setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function later() {
    if (update?.mandatory) return;
    setVisible(false);
    releaseStartupPrompt();
    snoozeUpdatePrompt();
  }

  function goToStore() {
    // De propósito não fechamos nem adiamos: a pessoa vai para a loja e volta
    // com o app novo. Se ela voltar sem atualizar, o aviso ainda está aqui.
    openStoreListing().catch(() => {});
  }

  if (!update) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={later}>
      <View style={styles.overlay}>
        {!update.mandatory && <Pressable style={StyleSheet.absoluteFill} onPress={later} />}
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.emoji}>🚀</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {update.mandatory ? t('update.mandatoryTitle') : t('update.title')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {update.mandatory
              ? t('update.mandatorySubtitle')
              : t('update.subtitle', { version: update.latestVersion })}
          </ThemedText>

          {update.highlights.length > 0 && (
            <ScrollView
              style={styles.highlights}
              contentContainerStyle={styles.highlightsContent}
              showsVerticalScrollIndicator={false}>
              {update.highlights.map((release) => (
                <View key={release.version} style={styles.releaseGroup}>
                  {/* O número da versão só aparece quando há mais de uma
                      pendente — com uma só ele não informa nada. */}
                  {update.highlights.length > 1 && (
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {t('update.versionLabel', { version: release.version })}
                    </ThemedText>
                  )}
                  {release.items.map((item) => (
                    <View key={item} style={styles.highlightRow}>
                      <ThemedText type="small" themeColor="accent">
                        •
                      </ThemedText>
                      <ThemedText type="small" style={styles.highlightText}>
                        {item}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.accent }]}
            onPress={goToStore}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('update.action')}
            </ThemedText>
          </Pressable>
          {!update.mandatory && (
            <Pressable style={styles.laterButton} onPress={later}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('update.later')}
              </ThemedText>
            </Pressable>
          )}
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
  highlights: {
    alignSelf: 'stretch',
    // Teto para a lista não empurrar os botões para fora em aparelho pequeno.
    maxHeight: 220,
    marginTop: Spacing.two,
  },
  highlightsContent: {
    gap: Spacing.three,
  },
  releaseGroup: {
    gap: Spacing.one,
  },
  highlightRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  highlightText: {
    flex: 1,
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
