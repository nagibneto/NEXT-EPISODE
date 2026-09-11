import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ActionSheetOption {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  /** Destaca a opção como a ação sugerida (cor de destaque, texto em negrito). */
  accent?: boolean;
  /** Marca a opção como a escolha atual (check à direita) — para menus de seleção. */
  selected?: boolean;
  onPress: () => void;
}

/**
 * Menu de ações no estilo folha inferior, com o visual do app — substitui o
 * Alert nativo (que no Android limita a 3 botões e destoa do tema). Fecha ao
 * tocar fora, no "Cancelar" ou no botão voltar do Android.
 */
export function ActionSheet({
  visible,
  title,
  options,
  scrollable = false,
  closeOnSelect = true,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: ActionSheetOption[];
  /** Listas longas (ex.: escolher streaming): rola dentro de uma altura fixa. */
  scrollable?: boolean;
  /**
   * `false` mantém a folha aberta ao tocar numa opção — para seleção múltipla
   * (marca/desmarca vários e fecha no "Fechar").
   */
  closeOnSelect?: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const optionRows = options.map((option) => (
    <Pressable
      key={option.label}
      style={({ pressed }) => [
        styles.option,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
      onPress={() => {
        if (closeOnSelect) onClose();
        option.onPress();
      }}>
      {option.icon ? (
        <Ionicons
          name={option.icon}
          size={20}
          color={option.destructive ? theme.danger : option.accent ? theme.accent : theme.text}
        />
      ) : null}
      <ThemedText
        type={option.accent || option.selected ? 'smallBold' : 'default'}
        themeColor={option.destructive ? 'danger' : option.accent ? 'accent' : 'text'}
        style={styles.optionLabel}>
        {option.label}
      </ThemedText>
      {option.selected ? (
        <Ionicons name="checkmark" size={20} color={theme.accent} />
      ) : null}
    </Pressable>
  ));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          {title ? (
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
              {title}
            </ThemedText>
          ) : null}
          {scrollable ? (
            <ScrollView
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {optionRows}
            </ScrollView>
          ) : (
            optionRows
          )}
          <Pressable
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
            ]}
            onPress={onClose}>
            <ThemedText type="smallBold">
              {closeOnSelect ? t('common.cancel') : t('common.close')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.half,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.one,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.one,
  },
  scroll: {
    maxHeight: 360,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: Spacing.two,
  },
  optionLabel: {
    flex: 1,
  },
  cancel: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: Spacing.one,
  },
});
