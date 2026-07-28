/**
 * Formatação de tempo assistido, compartilhada pelas telas que mostram
 * estatísticas (Estatísticas, ranking do Feed e perfil do amigo).
 */

/** Quebra o total em meses/dias/horas/minutos, para o número grande em destaque. */
export function formatDuration(totalMinutes: number) {
  const months = Math.floor(totalMinutes / (30 * 24 * 60));
  const days = Math.floor((totalMinutes % (30 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  return { months, days, hours, minutes };
}

/** Versão curta ("3d 14h", "5h 20min", "42 min") para linhas e quadrinhos. */
export function shortDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes} min`;
}
