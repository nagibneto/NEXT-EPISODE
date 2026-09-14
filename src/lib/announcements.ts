/**
 * Avisos pontuais mostrados uma única vez por usuário (banner ao abrir o app).
 *
 * O controle de "já apareceu" fica na tabela campaign_deliveries, por chave de
 * campanha (ver supabase/schema.sql). Para anunciar outra coisa no futuro,
 * troque CURRENT_ANNOUNCEMENT por uma campanha com chave NOVA — reaproveitar a
 * chave antiga faria o banner ficar escondido de quem já viu o aviso anterior.
 *
 * O push equivalente (para quem não abre o app) tem a mesma chave e vive em
 * supabase/functions/notify-announcement.
 */

import { Linking } from 'react-native';

export const INSTAGRAM_HANDLE = '@app.nextepisode';
export const INSTAGRAM_URL = 'https://www.instagram.com/app.nextepisode/';

export interface Announcement {
  /** Precisa ser igual à chave em supabase/functions/notify-announcement. */
  key: string;
  emoji: string;
  /** Prefixo das traduções (announcement.json, em cada idioma). */
  i18nKey: string;
  /** O que o botão principal faz. */
  action: () => Promise<void>;
}

/**
 * Abre o perfil no Instagram. Usamos a URL https em vez do esquema
 * instagram://: com o app instalado, o próprio sistema abre o Instagram pelo
 * link universal (iOS) / app link (Android), e sem o app cai no navegador —
 * enquanto instagram:// exigiria declarar o esquema no Info.plist e ainda
 * assim quebraria para quem não tem o app.
 *
 * Não existe forma de seguir a conta automaticamente: o Instagram não expõe
 * API pública de follow. O banner leva a pessoa até o perfil; o toque em
 * "Seguir" é dela.
 */
async function openInstagramProfile() {
  await Linking.openURL(INSTAGRAM_URL);
}

export const CURRENT_ANNOUNCEMENT: Announcement = {
  key: 'instagram-2026-09',
  emoji: '📸',
  i18nKey: 'announcement.instagram',
  action: openInstagramProfile,
};
