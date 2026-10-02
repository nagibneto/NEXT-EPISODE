const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? '';

// Config plugin do SDK da Meta é opcional: sem EXPO_PUBLIC_FACEBOOK_APP_ID no
// .env (ver .env.example) o plugin recusa fazer o prebuild, então nem
// incluímos ele — igual ao app.json antigo, ninguém é obrigado a ter uma
// credencial da Meta só pra rodar o projeto localmente.
const metaSdkPlugin = FACEBOOK_APP_ID
  ? [
      [
        'react-native-fbsdk-next',
        {
          appID: FACEBOOK_APP_ID,
          clientToken: process.env.FACEBOOK_CLIENT_TOKEN ?? '',
          displayName: 'Next Episode',
          scheme: `fb${FACEBOOK_APP_ID}`,
          advertiserIDCollectionEnabled: false,
          autoLogAppEventsEnabled: true,
          isAutoInitEnabled: true,
        },
      ],
    ]
  : [];

module.exports = {
  expo: {
    name: 'Next Episode',
    slug: 'next-episode',
    version: '1.0.8',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'nextepisode',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.nagibneto.nextepisode',
      appleTeamId: 'C2KT64ST28',
      entitlements: {
        'com.apple.security.application-groups': ['group.com.nagibneto.nextepisode'],
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        CFBundleDevelopmentRegion: 'pt-BR',
        CFBundleLocalizations: ['pt-BR', 'en-US'],
        NSPhotoLibraryAddUsageDescription:
          'O app usa a galeria para compartilhar o cartão de conquista no Instagram Stories.',
      },
    },
    android: {
      package: 'com.nagibneto.nextepisode',
      adaptiveIcon: {
        backgroundColor: '#0A0A0C',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-notifications',
      [
        'expo-image-picker',
        {
          photosPermission: 'O app acessa suas fotos para anexar imagens e GIFs aos comentários.',
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0A0A0C',
          image: './assets/images/splash-icon.png',
          imageWidth: 180,
        },
      ],
      'expo-localization',
      'expo-web-browser',
      'expo-apple-authentication',
      [
        'expo-contacts',
        {
          contactsPermission:
            'O app acessa seus contatos apenas para comparar números de telefone (por hash, sem enviar nenhum número em texto puro) e sugerir amigos que já usam o Next Episode.',
        },
      ],
      [
        'react-native-share',
        {
          ios: ['instagram-stories'],
          android: ['com.instagram.android'],
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.4',
          },
        },
      ],
      '@bacons/apple-targets',
      [
        'react-native-android-widget',
        {
          widgets: [
            {
              name: 'NextEpisode',
              label: 'Next Episode',
              description: 'O que falta assistir, as próximas estreias e o quiz do dia.',
              minWidth: '110dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
            },
          ],
        },
      ],
      // Manda eventos de uso do app (abertura, cadastro, login, série
      // seguida, episódio assistido) pro Gerenciador de Eventos da Meta —
      // sem isso as campanhas do Meta Ads não enxergam nada do que acontece
      // dentro do app, só as visitas ao site (ver Meta Pixel em docs/*.html).
      // advertiserIDCollectionEnabled fica false por enquanto: ligar o IDFA
      // exigiria o prompt de App Tracking Transparency, que ainda não existe
      // no app.
      ...metaSdkPlugin,
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'a3175347-d00d-4076-bbbe-0e927617ab89',
      },
    },
    owner: 'nagibn',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/a3175347-d00d-4076-bbbe-0e927617ab89',
    },
  },
};
