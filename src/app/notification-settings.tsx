import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  errorMessage,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/db';

const OPTIONS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'new_episodes',
    label: 'Episódios novos',
    description: 'Quando uma série que você segue tem episódio novo no ar.',
  },
  {
    key: 'friend_requests',
    label: 'Pedidos de amizade',
    description: 'Quando alguém quer ser seu amigo.',
  },
  {
    key: 'friend_accepted',
    label: 'Pedidos aceitos',
    description: 'Quando alguém aceita seu pedido de amizade.',
  },
  {
    key: 'feed_likes',
    label: 'Curtidas no que você assistiu',
    description: 'Quando um amigo curte uma série ou filme que você assistiu.',
  },
];

export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getNotificationPreferences(user.id)
      .then(setPrefs)
      .catch((err) => setError(errorMessage(err, 'Erro ao carregar preferências.')));
  }, [user]);

  async function handleToggle(key: keyof NotificationPreferences, value: boolean) {
    if (!user || !prefs) return;
    const previous = prefs;
    setError(null);
    setPrefs({ ...prefs, [key]: value });
    try {
      await updateNotificationPreferences(user.id, { [key]: value });
    } catch (err) {
      setPrefs(previous);
      setError(errorMessage(err, 'Não foi possível salvar a preferência.'));
    }
  }

  if (!prefs) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {error ? (
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
        Escolha o que você quer receber por notificação push.
      </ThemedText>
      {error && (
        <ThemedText type="small" themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      )}
      <View style={styles.list}>
        {OPTIONS.map((option) => (
          <View key={option.key} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowInfo}>
              <ThemedText type="smallBold">{option.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {option.description}
              </ThemedText>
            </View>
            <Switch
              value={prefs[option.key]}
              onValueChange={(value) => handleToggle(option.key, value)}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
              thumbColor="#ffffff"
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
  },
  intro: {
    marginBottom: Spacing.one,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  rowInfo: {
    flex: 1,
    gap: Spacing.half,
  },
});
