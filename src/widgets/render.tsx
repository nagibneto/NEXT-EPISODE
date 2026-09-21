"use no memo";

// Mesmo motivo de next-episode-widget.tsx: este arquivo monta JSX de widget e
// não pode passar pelo React Compiler.

/**
 * Monta o JSX do widget a partir do que está guardado no AsyncStorage.
 *
 * Fica separado do task handler porque o app também precisa desenhar: quando
 * publica dados novos, ele chama requestWidgetUpdate, que pede o JSX de volta.
 */

import type { WidgetInfo, WidgetRepresentation } from 'react-native-android-widget';

import { NextEpisodeWidget, PALETTES } from '@/widgets/next-episode-widget';
import { readConsumed, readPayload, readSection } from '@/widgets/storage';

/** Nome do widget: precisa bater com o `widgets[].name` em app.json. */
export const ANDROID_WIDGET_NAME = 'NextEpisode';

/**
 * Desenha as versões clara e escura de uma vez. O Android escolhe sozinho
 * conforme o tema do sistema — a extensão não é notificada quando o usuário
 * troca, então mandar as duas é a única forma de acompanhar.
 */
export async function renderNextEpisodeWidget(
  widgetInfo: WidgetInfo
): Promise<WidgetRepresentation> {
  const [payload, section, consumedIds] = await Promise.all([
    readPayload(),
    readSection(),
    readConsumed(),
  ]);

  const common = { payload, section, consumedIds, width: widgetInfo.width };

  return {
    light: <NextEpisodeWidget {...common} palette={PALETTES.light} />,
    dark: <NextEpisodeWidget {...common} palette={PALETTES.dark} />,
  };
}
