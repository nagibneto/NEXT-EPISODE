import { i18n } from './i18n';

/** "hoje" / "ontem" / "há N dias" / data completa, usado no feed e nas notificações. */
export function relativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return i18n.t('relativeDate.today');
  if (days === 1) return i18n.t('relativeDate.yesterday');
  if (days < 30) return i18n.t('relativeDate.daysAgo', { count: days });
  return date.toLocaleDateString(i18n.language);
}
