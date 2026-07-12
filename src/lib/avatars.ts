/**
 * Avatars que o usuário pode escolher no perfil (profiles.avatar_id no banco).
 * As imagens ficam em assets/images/avatars e vêm do Avatars.png original.
 */

import type { ImageSourcePropType } from 'react-native';

const sources: Record<number, ImageSourcePropType> = {
  1: require('../../assets/images/avatars/avatar-1.png'),
  2: require('../../assets/images/avatars/avatar-2.png'),
  3: require('../../assets/images/avatars/avatar-3.png'),
  4: require('../../assets/images/avatars/avatar-4.png'),
  5: require('../../assets/images/avatars/avatar-5.png'),
  6: require('../../assets/images/avatars/avatar-6.png'),
  7: require('../../assets/images/avatars/avatar-7.png'),
  8: require('../../assets/images/avatars/avatar-8.png'),
  9: require('../../assets/images/avatars/avatar-9.png'),
  10: require('../../assets/images/avatars/avatar-10.png'),
  11: require('../../assets/images/avatars/avatar-11.png'),
  12: require('../../assets/images/avatars/avatar-12.png'),
};

export const AVATAR_IDS = Object.keys(sources).map(Number);

/** Fonte da imagem do avatar, ou null quando o usuário não escolheu nenhum. */
export function avatarSource(avatarId: number | null | undefined): ImageSourcePropType | null {
  if (!avatarId) return null;
  return sources[avatarId] ?? null;
}
