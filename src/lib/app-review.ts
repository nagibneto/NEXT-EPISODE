/**
 * Modal "avalie o app": quando pedir e quando calar a boca.
 *
 * A regra é pedir depois de um momento bom (episódios marcados, quiz
 * respondido) e nunca no primeiro contato — pedir nota para quem acabou de
 * instalar é o caminho mais curto para uma estrela. O contador de momentos é
 * alimentado por registerReviewMoment(), chamado de dentro do app.
 *
 * Tudo mora no aparelho (AsyncStorage): a avaliação é por loja/aparelho e não
 * vale a pena uma tabela para isso. Reinstalar zera a contagem, o que é o
 * comportamento certo — a pessoa recomeça o namoro com o app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Chave para ligar o modal. Enquanto estiver false o contador continua
 * rodando (então, no dia em que ligar, quem já usa o app entra elegível na
 * hora) mas nada aparece na tela.
 */
export const REVIEW_PROMPT_ENABLED = false;

/** Momentos bons antes do primeiro pedido. */
const MOMENTS_BEFORE_FIRST_ASK = 15;
/** Momentos a mais exigidos a cada recusa — quem disse "agora não" espera mais. */
const MOMENTS_PER_EXTRA_ASK = 40;
/** Dias mínimos entre dois pedidos. */
const DAYS_BETWEEN_ASKS = 60;
/**
 * Quantas vezes no máximo perguntamos. As lojas também têm limite próprio
 * (a Apple mostra o pop-up nativo no máximo 3 vezes por ano), e insistir
 * mais que isso só irrita.
 */
const MAX_ASKS = 3;

const MOMENTS_KEY = 'app-review:moments';
const ASKS_KEY = 'app-review:asks';
const LAST_ASK_KEY = 'app-review:last-ask';
const DONE_KEY = 'app-review:done';

async function readNumber(key: string): Promise<number> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Conta mais um momento bom. Chamado de pontos onde a pessoa acabou de tirar
 * proveito do app (ver markEpisodeWatched em src/lib/db.ts). Nunca lança:
 * falhar em contar não pode derrubar a ação de verdade.
 */
export async function registerReviewMoment() {
  try {
    if (await AsyncStorage.getItem(DONE_KEY)) return;
    const moments = await readNumber(MOMENTS_KEY);
    await AsyncStorage.setItem(MOMENTS_KEY, String(moments + 1));
  } catch {
    // Sem drama: o pedido de avaliação simplesmente demora mais.
  }
}

/** Já é hora de pedir a avaliação? */
export async function shouldAskForReview(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(DONE_KEY)) return false;

    const asks = await readNumber(ASKS_KEY);
    if (asks >= MAX_ASKS) return false;

    const moments = await readNumber(MOMENTS_KEY);
    if (moments < MOMENTS_BEFORE_FIRST_ASK + asks * MOMENTS_PER_EXTRA_ASK) return false;

    const lastAsk = await AsyncStorage.getItem(LAST_ASK_KEY).catch(() => null);
    if (lastAsk) {
      const elapsed = Date.now() - Date.parse(lastAsk);
      if (Number.isFinite(elapsed) && elapsed < DAYS_BETWEEN_ASKS * 24 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Registra que o modal apareceu (conta como uma das MAX_ASKS tentativas). */
export async function markReviewAsked() {
  try {
    const asks = await readNumber(ASKS_KEY);
    await AsyncStorage.multiSet([
      [ASKS_KEY, String(asks + 1)],
      [LAST_ASK_KEY, new Date().toISOString()],
    ]);
  } catch {
    // Se não gravar, o pior caso é perguntar de novo na próxima abertura.
  }
}

/**
 * Encerra o assunto de vez: a pessoa foi para a loja avaliar. Não dá para
 * saber se ela realmente deixou a nota (nenhuma loja conta isso de volta),
 * então tratamos a ida como resposta final — insistir com quem já avaliou é
 * pior do que perder uma avaliação.
 */
export async function markReviewDone() {
  await AsyncStorage.setItem(DONE_KEY, new Date().toISOString()).catch(() => {});
}
