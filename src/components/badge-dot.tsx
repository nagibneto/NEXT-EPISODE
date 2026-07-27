import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Bolinha vermelha de notificação pendente. O elemento pai precisa conter o
 * texto/ícone normalmente (View do RN já é `position: relative` por padrão).
 */
export function BadgeDot({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return <View style={[styles.dot, { backgroundColor: theme.danger }]} />;
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
