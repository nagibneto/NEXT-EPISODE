/**
 * Target WidgetKit do Next Episode (plugin @bacons/apple-targets).
 *
 * O código Swift desta pasta vira uma extensão separada do app: ela roda
 * sozinha, sem JavaScript, e lê os dados que o app publica no App Group
 * (ver src/lib/widget-bridge.ios.ts).
 *
 * O App Group vem do app.json para os dois lados nunca saírem do lugar.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'NextEpisodeWidgets',
  displayName: 'Next Episode',
  // Botão dentro do widget (Button(intent:)) e containerBackground só existem
  // a partir do iOS 17 — em iPhones mais antigos o widget não aparece na
  // galeria, mas o app continua funcionando normalmente.
  deploymentTarget: '17.0',
  icon: '../../assets/images/icon.png',
  frameworks: ['UIKit'],
  colors: {
    // $accent e $widgetBackground são nomes reservados: pintam a tela de
    // configuração que aparece ao segurar o widget na tela inicial.
    $accent: { light: '#2E7CF0', dark: '#5C9EFF' },
    $widgetBackground: { light: '#FFFFFF', dark: '#000000' },
    // Os demais viram Color("nome") no Swift. Mesmos valores de
    // src/constants/theme.ts.
    accentColor: { light: '#2E7CF0', dark: '#5C9EFF' },
    // Texto/ícone por cima da cor de destaque (botões preenchidos).
    accentText: { light: '#FFFFFF', dark: '#081326' },
    cardBackground: { light: '#F0F0F3', dark: '#212225' },
    textPrimary: { light: '#000000', dark: '#FFFFFF' },
    textSecondary: { light: '#60646C', dark: '#B0B4BA' },
    goldColor: { light: '#8A5A00', dark: '#F5C518' },
    dangerColor: { light: '#D93025', dark: '#F28B82' },
  },
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
