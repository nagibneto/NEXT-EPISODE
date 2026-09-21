import { i18n } from './i18n';

/**
 * `toLocaleDateString` no idioma ativo do app — substitui as chamadas
 * espalhadas pelas telas que fixavam 'pt-BR'.
 */
export function formatDate(iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString(i18n.language, options);
}

/** `toLocaleString` no idioma ativo do app. */
export function formatDateTime(iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString(i18n.language, options);
}

/**
 * Nome/título gravado no banco em pt-BR (`primary`) e opcionalmente em
 * en-US (`alt`, `null` em registros antigos ainda não migrados — nesse
 * caso cai para o pt-BR mesmo com o app em inglês).
 */
/**
 * "Seg", "Ter"… a partir de uma data YYYY-MM-DD, no idioma pedido. Usado pela
 * fita da semana do quiz (no perfil e no widget), que precisa do rótulo curto
 * sem uma chave de tradução por dia.
 */
export function shortWeekdayLabel(date: string, language: string): string {
  const label = new Date(`${date}T00:00:00`)
    .toLocaleDateString(language, { weekday: 'short' })
    .replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function localizedTitle(primary: string, alt: string | null, language: string) {
  return language === 'en-US' && alt ? alt : primary;
}
