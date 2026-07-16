/**
 * Banner do AppLovin MAX exibido para quem não é premium.
 *
 * Sem o prompt de App Tracking Transparency o MAX serve anúncios contextuais
 * (sem IDFA), que é o comportamento que queremos por ora.
 *
 * O módulo nativo não existe no web nem no Expo Go, então o require é
 * protegido e o componente simplesmente não renderiza nada nesses ambientes.
 * Sem a SDK key / ad unit no ambiente, idem — o app funciona sem anúncios.
 *
 * (A versão anterior usava AdMob; ficou no commit "Premium + ads" caso um dia
 * o Google reabra a conta — aí o AdMob pode entrar como demanda dentro do MAX.)
 */

import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { usePremium } from '@/hooks/use-premium';

let max: typeof import('react-native-applovin-max') | null = null;
if (Platform.OS !== 'web') {
  try {
    // Import condicional: o módulo nativo não existe no web nem no Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    max = require('react-native-applovin-max');
  } catch {
    max = null;
  }
}

const sdkKey = process.env.EXPO_PUBLIC_APPLOVIN_SDK_KEY;

const adUnitId = Platform.select({
  ios: process.env.EXPO_PUBLIC_APPLOVIN_BANNER_IOS,
  android: process.env.EXPO_PUBLIC_APPLOVIN_BANNER_ANDROID,
});

let initialized = false;

export function AdBanner() {
  const { isPremium, loading } = usePremium();
  const [ready, setReady] = useState(initialized);

  const enabled =
    Boolean(max) && Boolean(sdkKey) && Boolean(adUnitId) && !isPremium && !loading;

  useEffect(() => {
    if (!enabled || initialized) return;
    max!.AppLovinMAX.initialize(sdkKey!)
      .then(() => {
        initialized = true;
        setReady(true);
      })
      .catch(() => {});
  }, [enabled]);

  if (!enabled || !ready || !max) return null;

  const { AdView, AdFormat } = max;

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Banner fixo 320x50 (adaptive desligado para a altura ser previsível
          em cima da tab bar). */}
      <AdView
        adUnitId={adUnitId!}
        adFormat={AdFormat.BANNER}
        adaptiveBannerEnabled={false}
        style={{ width: '100%', height: 50 }}
      />
    </View>
  );
}
