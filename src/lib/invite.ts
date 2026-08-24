import { Platform, Share } from 'react-native';

// Link de cada loja para o convite (ver a mensagem em profile.json).
const APP_STORE_URL = 'https://apps.apple.com/br/app/next-episode/id6789371179';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nagibneto.nextepisode';

/** Link da loja da plataforma atual, para montar a mensagem de convite. */
export function inviteStoreUrl() {
  return Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}

/**
 * Abre a folha de compartilhamento do sistema com o convite. O título vira o
 * cabeçalho do seletor no Android e o assunto do e-mail no iOS.
 */
export function shareInvite(message: string, title: string) {
  Share.share({ message, title }, { dialogTitle: title, subject: title }).catch(() => {});
}
