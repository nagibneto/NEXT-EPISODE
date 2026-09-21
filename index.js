/**
 * Entrada do app.
 *
 * Existe só para registrar a tarefa do widget do Android antes de qualquer
 * tela montar — o expo-router continua sendo quem sobe a aplicação. Sem este
 * arquivo, o "main" apontaria direto para 'expo-router/entry'.
 */

import 'expo-router/entry';

import { Platform } from 'react-native';

// O módulo do widget é só de Android: importar no iOS/web quebraria o
// bootstrap por causa de um recurso que nem existe nessas plataformas.
if (Platform.OS === 'android') {
  require('./src/widgets/register');
}
