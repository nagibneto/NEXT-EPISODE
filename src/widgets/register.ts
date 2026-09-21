/**
 * Registra a tarefa do widget no bootstrap do app (Android).
 *
 * Precisa acontecer no carregamento do bundle, e não dentro de um componente:
 * o Android também roda essa tarefa com o app fechado, quando ninguém montou
 * tela nenhuma. Por isso o import mora no index.js da raiz.
 */

import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from '@/widgets/task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
