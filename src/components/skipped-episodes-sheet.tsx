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
  return (
    <ActionSheet
      visible={visible}
      title={`Você está marcando um episódio avançado e deixou ${count} episódio${
        count === 1 ? '' : 's'
      } anterior${count === 1 ? '' : 'es'} como não assistido${
        count === 1 ? '' : 's'
      }. Quer deixá-los marcados como assistidos também?`}
      onClose={onClose}
      options={[
        { label: 'Só este episódio', onPress: onSkip },
        { label: 'Marcar todos como assistidos', accent: true, onPress: onMarkAll },
      ]}
    />
  );
}
