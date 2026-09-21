/**
 * Tarefa que o Android chama para desenhar o widget e para tratar os toques.
 *
 * Roda no contexto JS do app — inclusive com o app fechado, em modo headless.
 * Por isso não toca em nada que dependa da tela: só AsyncStorage e JSX.
 */

import type { WidgetTaskHandler, WidgetTaskHandlerProps } from 'react-native-android-widget';

import { CLICK_CHANGE_SECTION, CLICK_MARK_WATCHED } from '@/widgets/next-episode-widget';
import { renderNextEpisodeWidget } from '@/widgets/render';
import { enqueueWatched, moveSection } from '@/widgets/storage';

/** Trata os toques que voltam para o JS (OPEN_APP e OPEN_URI o Android resolve). */
async function handleClick(props: WidgetTaskHandlerProps): Promise<void> {
  const data = props.clickActionData ?? {};

  if (props.clickAction === CLICK_CHANGE_SECTION) {
    const delta = typeof data.delta === 'number' ? data.delta : 1;
    await moveSection(delta);
    return;
  }

  if (props.clickAction === CLICK_MARK_WATCHED) {
    const { showId, seasonNumber, episodeNumber } = data;
    if (
      typeof showId === 'number' &&
      typeof seasonNumber === 'number' &&
      typeof episodeNumber === 'number'
    ) {
      await enqueueWatched({ showId, seasonNumber, episodeNumber });
    }
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async (props) => {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(await renderNextEpisodeWidget(props.widgetInfo));
      break;

    case 'WIDGET_CLICK':
      await handleClick(props);
      // Redesenha em seguida: é o que faz a seta trocar a seção e o ✓ virar
      // círculo cheio no mesmo toque.
      props.renderWidget(await renderNextEpisodeWidget(props.widgetInfo));
      break;

    case 'WIDGET_DELETED':
      break;
  }
};
