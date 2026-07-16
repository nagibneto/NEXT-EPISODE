/**
 * Integração com o RevenueCat (assinatura premium).
 *
 * O RevenueCat cuida da compra In-App na App Store/Play Store e expõe o
 * entitlement "premium". O status também é replicado para
 * profiles.is_premium no Supabase pelo webhook
 * supabase/functions/revenuecat-webhook (fonte da verdade no servidor).
 */

import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo } from 'react-native-purchases';

/** Identificador do entitlement configurado no painel do RevenueCat. */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

const apiKey = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
});

let configured = false;

/**
 * Indica se dá para usar compras neste ambiente: precisa da chave no .env e
 * do módulo nativo (ou seja, não funciona no web nem no Expo Go).
 */
export function isPurchasesAvailable(): boolean {
  return Boolean(apiKey) && Platform.OS !== 'web';
}

/**
 * Configura o SDK e associa as compras ao usuário logado (o app user id do
 * RevenueCat = id do usuário no Supabase; é assim que o webhook sabe qual
 * perfil atualizar). Chamar a cada login; é seguro chamar mais de uma vez.
 */
export async function configurePurchases(userId: string) {
  if (!isPurchasesAvailable()) return;
  if (!configured) {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
    Purchases.configure({ apiKey: apiKey!, appUserID: userId });
    configured = true;
    return;
  }
  const current = await Purchases.getAppUserID();
  if (current !== userId) await Purchases.logIn(userId);
}

/** Desassocia o usuário ao sair da conta. */
export async function logOutPurchases() {
  if (!configured) return;
  await Purchases.logOut().catch(() => {});
}

/** O entitlement premium está ativo neste CustomerInfo? */
export function hasPremiumEntitlement(info: CustomerInfo): boolean {
  return Boolean(info.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
}
