import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { FriendStatus } from '@/hooks/use-friend-relations';

interface FriendStatusButtonProps {
  status: FriendStatus;
  busy: boolean;
  onSend: () => void;
  onAccept: () => void;
  /** Unfriend/cancelar pedido pedem confirmação — quem chama decide como (ver friends.tsx). */
  onRequestRemove: () => void;
}

/** Botão de amizade (pedir/pendente/amigo) reaproveitado por friends.tsx e find-friends-contacts.tsx. */
export function FriendStatusButton({ status, busy, onSend, onAccept, onRequestRemove }: FriendStatusButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (status === 'friend') {
    return (
      <View style={styles.statusGroup}>
        <View style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">{t('friends.friendsLabel')}</ThemedText>
        </View>
        <Pressable hitSlop={8} disabled={busy} onPress={onRequestRemove} style={styles.removeButton}>
          <Ionicons name="person-remove-outline" size={20} color={theme.danger} />
        </Pressable>
      </View>
    );
  }
  if (status === 'incoming') {
    return (
      <Pressable
        disabled={busy}
        onPress={onAccept}
        style={[styles.actionButton, { backgroundColor: theme.accent }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentText }}>
          {t('friends.accept')}
        </ThemedText>
      </Pressable>
    );
  }
  if (status === 'outgoing') {
    return (
      <View style={styles.statusGroup}>
        <View style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('friends.pending')}
          </ThemedText>
        </View>
        <Pressable hitSlop={8} disabled={busy} onPress={onRequestRemove} style={styles.removeButton}>
          <Ionicons name="close-circle-outline" size={20} color={theme.danger} />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      disabled={busy}
      onPress={onSend}
      style={[styles.actionButton, { backgroundColor: theme.accent }]}>
      <ThemedText type="smallBold" style={{ color: theme.accentText }}>
        {t('friends.add')}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  // "Amigos"/"Pendente" viram só rótulo; quem remove é o ícone ao lado, para
  // não apagar a relação num toque acidental.
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  removeButton: {
    padding: Spacing.half,
  },
});
