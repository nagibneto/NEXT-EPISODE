/**
 * Avatars que o usuário pode escolher no perfil (profiles.avatar_id no banco).
 * As imagens ficam em assets/images/avatars.
 * 1–12 vêm do Avatars.png original; 13–36 são exclusivos de assinantes premium
 * (Avatarts premium 1.png e Avatarts premium 2.png).
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
  13: require('../../assets/images/avatars/avatar-13.png'),
  14: require('../../assets/images/avatars/avatar-14.png'),
  15: require('../../assets/images/avatars/avatar-15.png'),
  16: require('../../assets/images/avatars/avatar-16.png'),
  17: require('../../assets/images/avatars/avatar-17.png'),
  18: require('../../assets/images/avatars/avatar-18.png'),
  19: require('../../assets/images/avatars/avatar-19.png'),
  20: require('../../assets/images/avatars/avatar-20.png'),
  21: require('../../assets/images/avatars/avatar-21.png'),
  22: require('../../assets/images/avatars/avatar-22.png'),
  23: require('../../assets/images/avatars/avatar-23.png'),
  24: require('../../assets/images/avatars/avatar-24.png'),
  25: require('../../assets/images/avatars/avatar-25.png'),
  26: require('../../assets/images/avatars/avatar-26.png'),
  27: require('../../assets/images/avatars/avatar-27.png'),
  28: require('../../assets/images/avatars/avatar-28.png'),
  29: require('../../assets/images/avatars/avatar-29.png'),
  30: require('../../assets/images/avatars/avatar-30.png'),
  31: require('../../assets/images/avatars/avatar-31.png'),
  32: require('../../assets/images/avatars/avatar-32.png'),
  33: require('../../assets/images/avatars/avatar-33.png'),
  34: require('../../assets/images/avatars/avatar-34.png'),
  35: require('../../assets/images/avatars/avatar-35.png'),
  36: require('../../assets/images/avatars/avatar-36.png'),
};

const FIRST_PREMIUM_ID = 13;

export const AVATAR_IDS = Object.keys(sources).map(Number);

export const FREE_AVATAR_IDS = AVATAR_IDS.filter((id) => id < FIRST_PREMIUM_ID);

export const PREMIUM_AVATAR_IDS = AVATAR_IDS.filter((id) => id >= FIRST_PREMIUM_ID);

/** Avatar exclusivo para assinantes premium? */
export function isPremiumAvatar(avatarId: number): boolean {
  return avatarId >= FIRST_PREMIUM_ID;
}

/** Fonte da imagem do avatar, ou null quando o usuário não escolheu nenhum. */
export function avatarSource(avatarId: number | null | undefined): ImageSourcePropType | null {
  if (!avatarId) return null;
  return sources[avatarId] ?? null;
}
