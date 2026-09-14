/**
 * Fila dos avisos que aparecem sozinhos ao abrir o app (modal do quiz e banner
 * de campanha). Sem isso os dois podem cair na tela no mesmo instante, um por
 * cima do outro — cada um decide se aparece depois de uma consulta própria, e
 * a ordem de resposta varia.
 *
 * Cada aviso chama acquireStartupPrompt() logo antes de se mostrar e
 * releaseStartupPrompt() ao fechar. Quem chegar enquanto outro está na tela
 * espera a vez em vez de desistir: o aviso não se perde, só entra em seguida.
 */

let busy = false;
const waiting: (() => void)[] = [];

/** Resolve quando for a vez deste aviso aparecer. */
export function acquireStartupPrompt(): Promise<void> {
  if (!busy) {
    busy = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

/** Libera a vez para o próximo da fila (se houver). */
export function releaseStartupPrompt() {
  const next = waiting.shift();
  // Continua ocupado: a vez passa direto para quem estava esperando.
  if (next) next();
  else busy = false;
}
