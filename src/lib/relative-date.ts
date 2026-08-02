/** "hoje" / "ontem" / "há N dias" / data completa, usado no feed e nas notificações. */
export function relativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return date.toLocaleDateString('pt-BR');
}
