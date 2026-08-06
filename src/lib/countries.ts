import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export interface CountryOption {
  code: CountryCode;
  dialCode: string;
  flag: string;
  name: string;
}

/** Aparecem primeiro no seletor, nessa ordem — o resto fica em ordem alfabética. */
const PRIORITY_ORDER: CountryCode[] = ['BR', 'US'];

/**
 * Nomes fixos pros países prioritários: garante que Brasil/Estados Unidos
 * apareçam certo mesmo se o aparelho não tiver os dados de Intl.DisplayNames
 * (nem todo Hermes/Android tem esse dado completo). Os demais países usam
 * Intl.DisplayNames quando disponível; sem isso, cai pra sigla (ex.: "DE").
 */
const KNOWN_NAMES: Partial<Record<CountryCode, Record<'pt-BR' | 'en-US', string>>> = {
  BR: { 'pt-BR': 'Brasil', 'en-US': 'Brazil' },
  US: { 'pt-BR': 'Estados Unidos', 'en-US': 'United States' },
};

function isoToFlagEmoji(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function countryName(code: CountryCode, language: string, displayNames: Intl.DisplayNames | null): string {
  const known = KNOWN_NAMES[code];
  if (known) return known[language === 'en-US' ? 'en-US' : 'pt-BR'];
  return displayNames?.of(code) ?? code;
}

/** Todos os países suportados pro seletor de telefone — Brasil e EUA primeiro, resto em ordem alfabética no idioma ativo. */
export function getCountryOptions(language: string): CountryOption[] {
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames([language], { type: 'region' });
  } catch {
    displayNames = null;
  }

  const options = getCountries().map((code) => ({
    code,
    dialCode: getCountryCallingCode(code),
    flag: isoToFlagEmoji(code),
    name: countryName(code, language, displayNames),
  }));

  options.sort((a, b) => {
    const aIndex = PRIORITY_ORDER.indexOf(a.code);
    const bIndex = PRIORITY_ORDER.indexOf(b.code);
    if (aIndex !== -1 || bIndex !== -1) {
      return (
        (aIndex === -1 ? PRIORITY_ORDER.length : aIndex) -
        (bIndex === -1 ? PRIORITY_ORDER.length : bIndex)
      );
    }
    return a.name.localeCompare(b.name, language);
  });

  return options;
}
