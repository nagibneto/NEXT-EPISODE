/**
 * Links do app nas lojas: o convite para amigos e a página de avaliação.
 *
 * Tudo aqui é só Linking/Share — nada de módulo nativo — então mudanças nesta
 * parte saem por OTA update, sem passar por review de loja.
 */

import { Linking, Platform, Share } from 'react-native';

const APP_STORE_ID = '6789371179';
const APP_STORE_URL = `https://apps.apple.com/br/app/next-episode/id${APP_STORE_ID}`;
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nagibneto.nextepisode';

/** Link da loja da plataforma atual, para montar a mensagem de convite. */
export function inviteStoreUrl() {
  return Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}

/**
 * Abre a ficha do app na loja, para atualizar. `market://` evita o desvio pelo
 * navegador no Android; sem a Play Store instalada (emulador, celular sem
 * Google) cai no link https.
 */
export async function openStoreListing() {
  if (Platform.OS === 'ios') {
    await Linking.openURL(APP_STORE_URL);
    return;
  }

  const marketUrl = 'market://details?id=com.nagibneto.nextepisode';
  const canOpenMarket = await Linking.canOpenURL(marketUrl).catch(() => false);
  await Linking.openURL(canOpenMarket ? marketUrl : PLAY_STORE_URL);
}

/**
 * Abre a ficha do app na loja já na tela de avaliar.
 *
 * iOS: `?action=write-review` faz a App Store abrir direto no formulário de
 * nota e comentário. Não usamos o pop-up nativo de 1–5 estrelas
 * (SKStoreReviewController) porque a Apple só o permite fora de um toque do
 * usuário — num botão "Avalie-nos" ele pode simplesmente não aparecer.
 *
 * Android: não existe link público que abra a caixa de avaliação, então o
 * destino é a ficha do app (onde as estrelas ficam logo abaixo da descrição).
 * `market://` abre a Play Store instalada sem passar pelo navegador; sem ela
 * (emulador, celular sem Google), cai no link https.
 */
export async function openStoreReview() {
  if (Platform.OS === 'ios') {
    await Linking.openURL(`${APP_STORE_URL}?action=write-review`);
    return;
  }

  const marketUrl = 'market://details?id=com.nagibneto.nextepisode';
  const canOpenMarket = await Linking.canOpenURL(marketUrl).catch(() => false);
  await Linking.openURL(canOpenMarket ? marketUrl : PLAY_STORE_URL);
}

/**
 * Abre a folha de compartilhamento do sistema com o convite. O título vira o
 * cabeçalho do seletor no Android e o assunto do e-mail no iOS.
 */
export function shareInvite(message: string, title: string) {
  Share.share({ message, title }, { dialogTitle: title, subject: title }).catch(() => {});
}
