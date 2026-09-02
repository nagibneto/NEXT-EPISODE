/**
 * Gera / atualiza a ordem de exibição do quiz diário.
 *
 * O quiz do dia NÃO segue a ordem do arquivo de perguntas: cada pergunta é
 * "sorteada" uma única vez para um dia. Este script lê src/data/quiz.json,
 * pega as perguntas que ainda não estão na fila (src/data/quiz-schedule.json),
 * embaralha e adiciona no fim. Perguntas que já estão na fila não mudam de
 * posição — ou seja, uma pergunta que já foi (ou vai) ao ar nunca se repete.
 *
 * Uso: node scripts/generate-quiz-schedule.js          (gera/atualiza a fila)
 *      node scripts/generate-quiz-schedule.js --status  (só mostra o calendário)
 * Rode toda vez que adicionar perguntas novas em src/data/quiz.json.
 */

const fs = require('fs');
const path = require('path');

const POOL_PATH = path.join(__dirname, '..', 'src', 'data', 'quiz.json');
const SCHEDULE_PATH = path.join(__dirname, '..', 'src', 'data', 'quiz-schedule.json');

// Precisa bater com QUIZ_START_DATE em src/lib/quiz.ts: a pergunta do dia é
// SCHEDULE[dias desde essa data].
const QUIZ_START_DATE = '2026-09-01';

function airDate(index) {
  const d = new Date(`${QUIZ_START_DATE}T00:00:00`);
  d.setDate(d.getDate() + index);
  return d.toISOString().slice(0, 10);
}

function todayIndex() {
  const start = new Date(`${QUIZ_START_DATE}T00:00:00`).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - start) / 86_400_000);
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
const poolIds = pool.map((q) => q.id);
const questionById = new Map(pool.map((q) => [q.id, q]));

const existing = fs.existsSync(SCHEDULE_PATH)
  ? JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'))
  : [];

/** Mostra o calendário: posição -> data -> pergunta, e o que já foi ao ar. */
function printStatus(schedule) {
  const ti = todayIndex();
  console.log(`\nInício do quiz: ${QUIZ_START_DATE}  (hoje = posição ${ti})\n`);
  schedule.forEach((id, index) => {
    const when = index < ti ? 'já foi' : index === ti ? '  HOJE' : 'futura';
    const q = questionById.get(id);
    const text = q ? q.question : '(pergunta removida do pool)';
    console.log(`  ${String(index + 1).padStart(3)}  ${airDate(index)}  ${when}  ${id}  ${text}`);
  });
  const aired = Math.max(0, Math.min(ti, schedule.length));
  console.log(`\n${aired} já foram ao ar · ${Math.max(0, schedule.length - aired)} ainda na fila`);
}

if (process.argv.includes('--status')) {
  printStatus(existing);
  process.exit(0);
}

// Tira do schedule ids que não existem mais no pool (pergunta removida).
const stillValid = existing.filter((id) => poolIds.includes(id));
const removed = existing.filter((id) => !poolIds.includes(id));

const alreadyScheduled = new Set(stillValid);
const newIds = shuffle(poolIds.filter((id) => !alreadyScheduled.has(id)));

const schedule = [...stillValid, ...newIds];

fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2) + '\n');

console.log(`Pool: ${poolIds.length} perguntas`);
if (removed.length) console.log(`Removidas do schedule (não existem mais): ${removed.join(', ')}`);
console.log(`Já agendadas (posição mantida): ${stillValid.length}`);
console.log(`Novas adicionadas ao fim (embaralhadas): ${newIds.length}`);
console.log(`Total na fila: ${schedule.length} dias de quiz`);
if (newIds.length) {
  console.log(
    `As novas vão ao ar de ${airDate(stillValid.length)} a ${airDate(schedule.length - 1)}.`
  );
}
console.log(`\nRode com --status pra ver o calendário completo (posição -> data -> pergunta).`);
