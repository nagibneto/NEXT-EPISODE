import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { scheduleDailyQuizNotification } from '@/lib/notifications';

const OPTION_KEYS: (keyof NotificationPreferences)[] = [
  'new_episodes',
  'friend_requests',
  'friend_accepted',
  'feed_likes',
  'daily_quiz',
];

export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  const OPTIONS = OPTION_KEYS.map((key) => ({
    key,
    label: t(`notificationSettings.options.${key}.label`),
    description: t(`notificationSettings.options.${key}.description`),
  }));

  useEffect(() => {
    if (!user) return;
    getNotificationPreferences(user.id)
      .then(setPrefs)
      .catch((err) => setError(errorMessage(err, t('notificationSettings.loadError'))));
  }, [user]);

  async function handleToggle(key: keyof NotificationPreferences, value: boolean) {
    if (!user || !prefs) return;
    const previous = prefs;
    setError(null);
    setPrefs({ ...prefs, [key]: value });
    try {
      await updateNotificationPreferences(user.id, { [key]: value });
      // Diferente das demais (push remoto, decididas no servidor): a do quiz é
      // uma notificação local já agendada no aparelho, então precisa reagendar
      // (ou cancelar) na hora para o toggle surtir efeito imediato.
      if (key === 'daily_quiz') {
        scheduleDailyQuizNotification(user.id).catch(() => {});
      }
    } catch (err) {
      setPrefs(previous);
      setError(errorMessage(err, t('notificationSettings.saveError')));
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
        {t('notificationSettings.intro')}
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
