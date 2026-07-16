import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { avatarSource } from '@/lib/avatars';

const crownSource = require('../../assets/images/crown.png');
/** Proporção altura/largura do assets/images/crown.png (265x161). */
const CROWN_RATIO = 161 / 265;

interface UserAvatarProps {
  avatarId: number | null | undefined;
  /** Nome exibido — a inicial vira o fallback quando não há avatar escolhido. */
  name: string;
  size?: number;
  /** Assinante premium: coroinha dourada apoiada no topo do avatar. */
  premium?: boolean;
}

export function UserAvatar({ avatarId, name, size = 32, premium = false }: UserAvatarProps) {
  const theme = useTheme();
  const source = avatarSource(avatarId);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  const avatar = source ? (
    <Image source={source} style={circle} contentFit="cover" />
  ) : (
    <View style={[styles.fallback, circle, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText
        type="smallBold"
        themeColor="textSecondary"
        style={{ fontSize: size * 0.45, lineHeight: size }}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </ThemedText>
    </View>
  );

  if (!premium) return avatar;

  const crownWidth = Math.max(12, Math.round(size * 0.55));
  const crownHeight = Math.round(crownWidth * CROWN_RATIO);

  return (
    <View style={{ width: size, height: size }}>
      {avatar}
      <Image
        source={crownSource}
        contentFit="contain"
        style={[
          styles.crown,
          // Boa parte da coroa fica "para fora" do avatar, como um chapéu.
          { width: crownWidth, height: crownHeight, top: -Math.round(crownHeight * 0.6) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  crown: {
    position: 'absolute',
    alignSelf: 'center',
  },
});
