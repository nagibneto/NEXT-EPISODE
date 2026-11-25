/**
 * Nome de jogo comparável entre plataformas (IGDB × PSN × Xbox): sem acento,
 * sem ™/®/©, sem "Trophies", sem marcações de plataforma como "(PS4)",
 * "PS5 Edition", "for Windows 10" ou "Xbox Series X|S" — as lojas enfeitam os
 * nomes assim, e o casamento é por nome porque não há id em comum.
 */
export function normalizeGameName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\b(trophies|trofeus|trophy set)\b/g, ' ')
    .replace(/\(?\b(ps4|ps5|playstation ?[345]|ps vita)\b( edition)?\)?/g, ' ')
    .replace(/\(?\b(for )?windows( 10| 11)?( edition)?\b\)?/g, ' ')
    .replace(/\(?\b(xbox series x\s*\|?\s*s|xbox series x|xbox one|xbox 360)\b( edition)?\)?/g, ' ')
    .replace(/\(pc\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Palavras de edição que não mudam qual é o jogo.
const EDITION_WORDS =
  /\b(standard|deluxe|ultimate|gold|premium|complete|definitive|enhanced|remastered|game of the year|goty|director s cut|digital|edition|bundle|hd)\b/g;

/**
 * Pontua o quanto `candidate` (nome na plataforma) bate com `target` (nome
 * na IGDB): 3 = igual; 2 = igual depois de tirar palavras de edição
 * ("Deluxe Edition", "Remastered"…); 0 = não bate. "Elden Ring" ×
 * "Elden Ring Nightreign" dá 0 — são jogos diferentes.
 */
export function nameMatchScore(candidate: string, target: string) {
  const a = normalizeGameName(candidate);
  const b = normalizeGameName(target);
  if (!a || !b) return 0;
  if (a === b) return 3;
  const strip = (name: string) => name.replace(EDITION_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const sa = strip(a);
  if (sa && sa === strip(b)) return 2;
  return 0;
}
