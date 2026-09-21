/**
 * Versão instalada do app e comparação entre versões.
 *
 * A versão vem de app.json -> expo.version. Em OTA update o bundle novo roda
 * sobre a build antiga, então este número é o da build da loja (o que a gente
 * quer: é ele que diz se a pessoa precisa baixar de novo).
 */

import Constants from 'expo-constants';

/** "1.0.6" — string vazia só em ambiente sem manifest (teste/web isolado). */
export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

/**
 * Compara duas versões no formato "1.0.6": < 0 se a < b, 0 se iguais, > 0 se
 * a > b. Partes faltando contam como zero ("1.1" === "1.1.0"), e qualquer
 * coisa que não seja número vira zero — versão malformada nunca deve fazer o
 * modal aparecer sozinho.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const numA = Number.parseInt(partsA[i] ?? '0', 10) || 0;
    const numB = Number.parseInt(partsB[i] ?? '0', 10) || 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

/** `version` é mais nova que a que está instalada? */
export function isNewerThanInstalled(version: string): boolean {
  const installed = currentAppVersion();
  if (!installed) return false;
  return compareVersions(version, installed) > 0;
}
