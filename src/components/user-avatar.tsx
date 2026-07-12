import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { avatarSource } from '@/lib/avatars';

interface UserAvatarProps {
  avatarId: number | null | undefined;
  /** Nome exibido — a inicial vira o fallback quando não há avatar escolhido. */
  name: string;
  size?: number;
}

export function UserAvatar({ avatarId, name, size = 32 }: UserAvatarProps) {
  const theme = useTheme();
  const source = avatarSource(avatarId);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (source) {
    return <Image source={source} style={circle} contentFit="cover" />;
  }

  return (
    <View style={[styles.fallback, circle, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText
        type="smallBold"
        themeColor="textSecondary"
        style={{ fontSize: size * 0.45, lineHeight: size }}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
