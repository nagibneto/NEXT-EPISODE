/**
 * Banner do AdMob exibido para quem não é premium.
 *
 * Serve apenas anúncios NÃO personalizados (requestNonPersonalizedAdsOnly),
 * o que dispensa o prompt de App Tracking Transparency da Apple.
 *
 * O módulo nativo não existe no web nem no Expo Go, então o require é
 * protegido e o componente simplesmente não renderiza nada nesses ambientes.
 */

import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { usePremium } from '@/hooks/use-premium';

let ads: typeof import('react-native-google-mobile-ads') | null = null;
if (Platform.OS !== 'web') {
  try {
    // Import condicional: o módulo nativo não existe no web nem no Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ads = require('react-native-google-mobile-ads');
  } catch {
    ads = null;
  }
}

const adUnitId = Platform.select({
  ios: process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS,
  android: process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID,
});

let initialized = false;

export function AdBanner() {
  const { isPremium, loading } = usePremium();
  const [ready, setReady] = useState(initialized);

  const enabled = Boolean(ads) && !isPremium && !loading && (Boolean(adUnitId) || __DEV__);

  useEffect(() => {
    if (!enabled || initialized) return;
    ads!
      .default()
      .initialize()
      .then(() => {
        initialized = true;
        setReady(true);
      })
      .catch(() => {});
  }, [enabled]);

  if (!enabled || !ready || !ads) return null;

  const { BannerAd, BannerAdSize, TestIds } = ads;
  const unitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : adUnitId!;

  return (
    <View style={{ alignItems: 'center' }}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}
