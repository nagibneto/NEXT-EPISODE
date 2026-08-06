import { useTranslation } from 'react-i18next';

import { ActionSheet } from '@/components/action-sheet';

interface SkippedEpisodesSheetProps {
  visible: boolean;
  count: number;
  onClose: () => void;
  onSkip: () => void;
  onMarkAll: () => void;
}

/**
 * Aviso ao marcar um episódio avançado deixando episódios anteriores como
 * não assistidos: pergunta se o usuário quer marcá-los também.
 */
export function SkippedEpisodesSheet({
  visible,
  count,
  onClose,
  onSkip,
  onMarkAll,
}: SkippedEpisodesSheetProps) {
  const { t } = useTranslation();

  return (
    <ActionSheet
      visible={visible}
      title={t('skippedEpisodesSheet.message', { count })}
      onClose={onClose}
      options={[
        { label: t('skippedEpisodesSheet.skipOption'), onPress: onSkip },
        { label: t('skippedEpisodesSheet.markAllOption'), accent: true, onPress: onMarkAll },
      ]}
    />
  );
}
