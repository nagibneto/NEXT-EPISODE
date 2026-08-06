/**
 * Normalização (E.164) e hash de telefone para a busca de amigos pelos
 * contatos do celular (ver src/lib/contacts.ts e src/lib/db.ts).
 *
 * Números de contato e digitação livre vêm em formatos muito inconsistentes
 * ("(11) 99999-9999", "11999999999", "+55 11 99999-9999" etc.) — por isso o
 * parse usa libphonenumber-js em vez de um regex caseiro, que erraria
 * silenciosamente (falso-negativo: número que deveria bater não bate, sem
 * nenhum erro visível).
 */

import * as Crypto from 'expo-crypto';
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Idioma ativo do app -> país padrão assumido quando o número não vem com +código. */
export function defaultCountryForLanguage(language: string): CountryCode {
  return language.startsWith('en') ? 'US' : 'BR';
}

/** Normaliza para E.164 (ex.: "+5511999999999"); retorna null se não for um número válido. */
export function normalizePhoneNumber(raw: string, defaultCountry: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** SHA-256 em hexadecimal, usado tanto para o próprio telefone quanto para os contatos do celular. */
export async function hashPhoneNumber(e164: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, e164);
}

/**
 * Tamanho do DDD/area code em cada país — só os que a gente sabe de forma
 * confiável. Fora daqui, a variante "sem DDD" não é gerada (a ambiguidade de
 * adivinhar isso errado é pior do que simplesmente não tentar).
 *
 * Espelhado em supabase/functions/set-phone-number e match-contacts (Deno
 * não importa módulos do app diretamente).
 */
export const AREA_CODE_LENGTH: Partial<Record<CountryCode, number>> = {
  BR: 2,
  US: 3,
  CA: 3,
};

/**
 * Alguém pode ter salvo o seu contato de um jeito diferente do que você
 * cadastrou (sem "+55", ou até sem o DDD). Pra não perder esse match, a
 * busca compara três variantes do mesmo número, da mais específica pra
 * menos específica:
 *   1. E.164 completo         (+5511987654321)
 *   2. Número nacional        (11987654321, sem o código do país)
 *   3. Número local           (987654321, sem DDD — só quando o país está
 *      em AREA_CODE_LENGTH)
 * Cada variante vira um hash SEPARADO (ver hashPhoneNumber) — nenhuma delas
 * expõe o número em si, só permite achar mais gente que já usa o app.
 */
export function phoneMatchVariants(e164: string): string[] {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return [e164];

  const variants = new Set([e164, parsed.nationalNumber]);
  const areaCodeLength = parsed.country ? AREA_CODE_LENGTH[parsed.country] : undefined;
  if (areaCodeLength && parsed.nationalNumber.length > areaCodeLength) {
    variants.add(parsed.nationalNumber.slice(areaCodeLength));
  }
  return Array.from(variants);
}
