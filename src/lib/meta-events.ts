/**
 * Eventos de uso do app pro Meta Ads (App Events), via react-native-fbsdk-next.
 * Sem isso o Meta só enxerga visitas ao site pelo Pixel (docs/index.html),
 * nunca o que acontece dentro do app iOS/Android.
 *
 * Só funciona com EXPO_PUBLIC_FACEBOOK_APP_ID configurado (ver
 * .env.example): sem ele o plugin nem entra no build (app.config.js) e as
 * funções abaixo viram no-op, então é seguro chamá-las sempre.
 */
import { Platform } from 'react-native';
import { AppEventsLogger, Settings } from 'react-native-fbsdk-next';

const enabled = Platform.OS !== 'web' && !!process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

/**
 * O evento de "app aberto/ativado" (fb_mobile_activate_app) é automático:
 * autoLogAppEventsEnabled no plugin (app.config.js) já faz o SDK nativo
 * disparar isso sozinho a cada volta pro primeiro plano, sem precisar chamar
 * nada daqui — a lib nem expõe um `activateApp()` em JS.
 */
export function initMetaEvents() {
  if (!enabled) return;
  Settings.initializeSDK();
}

type AuthMethod = 'email' | 'apple' | 'google' | 'facebook';

export function logMetaSignUp(method: AuthMethod) {
  if (!enabled) return;
  AppEventsLogger.logEvent(AppEventsLogger.AppEvents.CompletedRegistration, {
    [AppEventsLogger.AppEventParams.RegistrationMethod]: method,
  });
}

export function logMetaLogin(method: AuthMethod) {
  if (!enabled) return;
  AppEventsLogger.logEvent('Login', { registration_method: method });
}

export function logMetaShowFollowed() {
  if (!enabled) return;
  AppEventsLogger.logEvent('ShowFollowed');
}

export function logMetaEpisodeWatched() {
  if (!enabled) return;
  AppEventsLogger.logEvent('EpisodeWatched');
}
