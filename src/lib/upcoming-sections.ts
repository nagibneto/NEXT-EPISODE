/**
 * Agrupamento por data usado na aba "Em breve" (episódios e filmes) e na
 * faixa "Esta semana" da tela inicial.
 */

import type { TFunction } from 'i18next';

import { formatDate } from './locale';

/** Uma faixa da lista: "Nos próximos 7 dias" ou um mês ("Outubro"). */
export interface DateSection<T> {
  key: string;
  title: string;
  /** Estreias da semana ganham "Hoje/Amanhã/Em N dias" ao lado da data curta. */
  soon: boolean;
  data: T[];
}

/** Dias inteiros entre hoje (meia-noite local) e a data (YYYY-MM-DD). */
export function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Rótulo relativo curto da semana: "Hoje! 🎉", "Amanhã", "Em 5 dias". */
export function relativeLabel(days: number, t: TFunction): string {
  if (days <= 0) return t('upcoming.today');
  if (days === 1) return t('upcoming.tomorrow');
  return t('upcoming.inDays', { count: days });
}

/**
 * Agrupa itens já ordenados por data em "Nos próximos 7 dias" e depois um
 * bloco por mês. O ano só entra no título do mês quando não é o atual (ex.:
 * "Janeiro de 2027"), para a lista não ficar poluída no caso comum.
 */
export function buildDateSections<T>(
  items: T[],
  dateOf: (item: T) => string,
  t: TFunction
): DateSection<T>[] {
  const soon: T[] = [];
  const byMonth = new Map<string, T[]>();
  const thisYear = new Date().getFullYear();

  for (const item of items) {
    const date = dateOf(item);
    if (daysUntil(date) <= 7) {
      soon.push(item);
      continue;
    }
    const monthKey = date.slice(0, 7); // YYYY-MM
    const list = byMonth.get(monthKey);
    if (list) list.push(item);
    else byMonth.set(monthKey, [item]);
  }

  const sections: DateSection<T>[] = [];
  if (soon.length > 0) {
    sections.push({ key: 'soon', title: t('upcoming.nextSevenDays'), soon: true, data: soon });
  }
  // O Map preserva a ordem de inserção e a lista já vem ordenada por data.
  for (const [monthKey, data] of byMonth) {
    const iso = `${monthKey}-01T00:00:00`;
    const sameYear = Number(monthKey.slice(0, 4)) === thisYear;
    const label = formatDate(iso, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
    sections.push({
      key: monthKey,
      // Intl devolve o mês em minúscula em pt-BR ("outubro").
      title: label.charAt(0).toUpperCase() + label.slice(1),
      soon: false,
      data,
    });
  }
  return sections;
}
