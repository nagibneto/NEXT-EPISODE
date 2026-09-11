/**
 * Quiz diário: uma pergunta por dia sobre cinema e séries. O usuário responde
 * uma vez ao dia e mantém um streak de acertos consecutivos — um dia sem
 * responder (ou uma resposta errada) zera o streak.
 *
 * As perguntas ficam em src/data/quiz.json (embarcado, bilíngue pt-BR/en-US).
 * A ordem em que aparecem NÃO é a do arquivo: src/data/quiz-schedule.json tem
 * a fila "sorteada" — cada pergunta vai ao ar uma única vez, num dia. Ao
 * adicionar perguntas novas, rode `node scripts/generate-quiz-schedule.js`
 * para embaralhá-las e adicioná-las ao fim da fila (sem repetir as antigas).
 *
 * Histórico e streak ficam no Supabase (tabela quiz_answers, ver
 * supabase/schema.sql) para acompanhar o usuário entre aparelhos.
 */

import quizSchedule from '@/data/quiz-schedule.json';
import quizPool from '@/data/quiz.json';

import { getFriends, getProfile, profileDisplayName, type Profile } from './db';
import { i18n } from './i18n';
import { supabase } from './supabase';

/** Pergunta como está no JSON: pt-BR nos campos base, en-US nos `*En`. */
export interface RawQuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  questionEn?: string;
  optionsEn?: string[];
  explanationEn?: string;
  categoryEn?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  spoiler: boolean;
}

/** Pergunta já resolvida no idioma ativo e com as alternativas embaralhadas. */
export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  spoiler: boolean;
}

const POOL = quizPool as RawQuizQuestion[];
const SCHEDULE = quizSchedule as string[];

// Dia 0 do quiz. SCHEDULE[N] é a pergunta do N-ésimo dia a partir daqui.
const QUIZ_START_DATE = '2026-09-01';

/**
 * Hora local em que o quiz "vira": a pergunta nova entra às 20h, junto com a
 * notificação diária (QUIZ_NOTIFICATION_HOUR em src/lib/notifications.ts
 * reexporta esta constante para as duas nunca saírem de sincronia). Antes das
 * 20h ainda vale a pergunta do dia anterior — assim, quando a notificação
 * chega, sempre há algo novo para responder.
 */
export const QUIZ_RESET_HOUR = 20;

/** Formata uma Date como YYYY-MM-DD no fuso do aparelho. */
function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Data (YYYY-MM-DD) do quiz vigente no fuso do aparelho. Como o quiz vira às
 * QUIZ_RESET_HOUR, antes desse horário a data ainda é a do dia anterior. O
 * quiz rotulado 02/09 fica no ar das 20h de 02/09 às 20h de 03/09.
 */
export function todayQuizDate(base: Date = new Date()): string {
  const day = new Date(base);
  if (base.getHours() < QUIZ_RESET_HOUR) day.setDate(day.getDate() - 1);
  return toISODate(day);
}

/** Diferença em dias inteiros entre duas datas YYYY-MM-DD (fuso local). */
function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00`).getTime();
  const to = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Soma (ou subtrai) dias a uma data YYYY-MM-DD, devolvendo outra YYYY-MM-DD. */
function shiftDate(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

// ---------- Escolha e localização da pergunta ----------

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return hash >>> 0;
}

/** PRNG determinístico (mulberry32) para embaralhar as alternativas de forma estável. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function isEnglish(language: string): boolean {
  return language.toLowerCase().startsWith('en');
}

/**
 * Resolve a pergunta para o idioma e embaralha as alternativas (seed fixa pelo
 * id, então a ordem é sempre a mesma para a mesma pergunta, mas não é "sempre
 * a primeira"). Sem tradução em inglês, cai para o pt-BR.
 */
export function localizeQuestion(raw: RawQuizQuestion, language: string): QuizQuestion {
  const en = isEnglish(language);
  const options =
    en && raw.optionsEn && raw.optionsEn.length === raw.options.length ? raw.optionsEn : raw.options;
  const correctAnswer = options[raw.correctIndex];
  const shuffled = seededShuffle(options, hashString(raw.id));
  return {
    id: raw.id,
    question: (en && raw.questionEn) || raw.question,
    options: shuffled,
    correctIndex: shuffled.indexOf(correctAnswer),
    explanation: (en && raw.explanationEn) || raw.explanation,
    category: (en && raw.categoryEn) || raw.category,
    difficulty: raw.difficulty,
    spoiler: raw.spoiler,
  };
}

/** Pergunta crua do dia (null quando a fila do schedule já acabou). */
export function rawQuestionForDate(dateISO: string): RawQuizQuestion | null {
  const index = daysBetween(QUIZ_START_DATE, dateISO);
  if (index < 0 || index >= SCHEDULE.length) return null;
  return POOL.find((question) => question.id === SCHEDULE[index]) ?? null;
}

// ---------- Histórico e streak (Supabase) ----------

export interface QuizAnswer {
  quiz_date: string;
  question_id: string;
  selected_index: number;
  is_correct: boolean;
  answered_at: string;
}

/** Um dia da faixa "segunda a domingo" mostrada no card do quiz. */
export interface QuizWeekDay {
  /** Data do quiz (YYYY-MM-DD). */
  date: string;
  /** 0 = segunda … 6 = domingo. */
  weekday: number;
  answered: boolean;
  correct: boolean;
  /** Dia da semana que ainda não chegou. */
  future: boolean;
}

export interface QuizState {
  /** Pergunta de hoje já localizada, ou null se a fila acabou. */
  question: QuizQuestion | null;
  quizDate: string;
  /** Resposta de hoje, se o usuário já respondeu; senão null. */
  today: QuizAnswer | null;
  /** Dias seguidos de acerto terminando hoje (ou ontem, se ainda não respondeu hoje). */
  currentStreak: number;
  bestStreak: number;
  totalAnswered: number;
  totalCorrect: number;
  /** Soma de pontos de todos os acertos (ver computeScore). */
  totalScore: number;
  /** Semana atual (segunda a domingo) com acerto/erro de cada dia. */
  week: QuizWeekDay[];
}

/** Pontos de uma pergunta acertada: 2 para difícil, 1 para fácil/média. */
function pointsForQuestion(questionId: string): number {
  const raw = POOL.find((question) => question.id === questionId);
  return raw?.difficulty === 'hard' ? 2 : 1;
}

/** Soma os pontos de todos os acertos do histórico (erros valem 0). */
export function computeScore(answers: Pick<QuizAnswer, 'question_id' | 'is_correct'>[]): number {
  return answers.reduce(
    (total, answer) => total + (answer.is_correct ? pointsForQuestion(answer.question_id) : 0),
    0
  );
}

export async function getQuizAnswers(userId: string): Promise<QuizAnswer[]> {
  const { data, error } = await supabase
    .from('quiz_answers')
    .select('quiz_date, question_id, selected_index, is_correct, answered_at')
    .eq('user_id', userId)
    .order('quiz_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Streak atual e recorde a partir do histórico. O streak atual conta os dias
 * consecutivos com acerto terminando hoje; se o usuário ainda não respondeu
 * hoje, conta a partir de ontem (o dia de hoje ainda está "em aberto").
 */
export function computeStreaks(
  answers: Pick<QuizAnswer, 'quiz_date' | 'is_correct'>[],
  todayISO: string
): { current: number; best: number } {
  const byDate = new Map(answers.map((answer) => [answer.quiz_date, answer]));

  let cursor = byDate.has(todayISO) ? todayISO : shiftDate(todayISO, -1);
  let current = 0;
  while (true) {
    const answer = byDate.get(cursor);
    if (!answer || !answer.is_correct) break;
    current += 1;
    cursor = shiftDate(cursor, -1);
  }

  const ascending = [...answers].sort((a, b) => a.quiz_date.localeCompare(b.quiz_date));
  let best = 0;
  let run = 0;
  let previousDate: string | null = null;
  for (const answer of ascending) {
    if (!answer.is_correct) {
      run = 0;
      previousDate = answer.quiz_date;
      continue;
    }
    run = previousDate && daysBetween(previousDate, answer.quiz_date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previousDate = answer.quiz_date;
  }

  return { current, best };
}

/**
 * Semana corrente do quiz (segunda a domingo) com o resultado de cada dia —
 * alimenta a faixa de bolinhas do card no perfil. Dias ainda não respondidos e
 * os que nem chegaram vêm com `answered: false` (`future` separa os dois).
 */
export function computeWeek(
  answers: Pick<QuizAnswer, 'quiz_date' | 'is_correct'>[],
  todayISO: string
): QuizWeekDay[] {
  const byDate = new Map(answers.map((answer) => [answer.quiz_date, answer]));
  // getDay() devolve 0 para domingo; aqui a semana começa na segunda.
  const offset = (new Date(`${todayISO}T00:00:00`).getDay() + 6) % 7;
  const monday = shiftDate(todayISO, -offset);
  return Array.from({ length: 7 }, (_, weekday) => {
    const date = shiftDate(monday, weekday);
    const answer = byDate.get(date);
    return {
      date,
      weekday,
      answered: answer !== undefined,
      correct: answer?.is_correct ?? false,
      future: date > todayISO,
    };
  });
}

export async function getQuizState(userId: string): Promise<QuizState> {
  const quizDate = todayQuizDate();
  const raw = rawQuestionForDate(quizDate);
  const question = raw ? localizeQuestion(raw, i18n.language) : null;
  const answers = await getQuizAnswers(userId);
  const today = answers.find((answer) => answer.quiz_date === quizDate) ?? null;
  const { current, best } = computeStreaks(answers, quizDate);
  return {
    question,
    quizDate,
    today,
    currentStreak: current,
    bestStreak: best,
    totalAnswered: answers.length,
    totalCorrect: answers.filter((answer) => answer.is_correct).length,
    totalScore: computeScore(answers),
    week: computeWeek(answers, quizDate),
  };
}

/**
 * Grava a resposta do dia. Uma por usuário por dia (chave primária no banco):
 * se já existir, o insert falha e a tela deve impedir esse caminho.
 */
export async function submitQuizAnswer(
  userId: string,
  quizDate: string,
  question: QuizQuestion,
  selectedIndex: number
): Promise<QuizAnswer> {
  const { data, error } = await supabase
    .from('quiz_answers')
    .insert({
      user_id: userId,
      quiz_date: quizDate,
      question_id: question.id,
      selected_index: selectedIndex,
      is_correct: selectedIndex === question.correctIndex,
    })
    .select('quiz_date, question_id, selected_index, is_correct, answered_at')
    .single();
  if (error) throw error;
  return data;
}

// ---------- Placar de escaladas (amigos) ----------

export interface QuizLeaderboardEntry {
  user: Profile;
  currentStreak: number;
  bestStreak: number;
  totalScore: number;
  answeredToday: boolean;
  isMe: boolean;
}

/**
 * Escalada atual do usuário e dos amigos aceitos, do maior para o menor.
 * Uma consulta só em quiz_answers (RLS libera as linhas dos amigos, ver
 * "Amigos veem respostas do quiz" em supabase/schema.sql) — leve o bastante
 * para rodar toda vez que a tela do quiz abre. Lista vazia = sem amigos.
 */
export async function getQuizLeaderboard(userId: string): Promise<QuizLeaderboardEntry[]> {
  const [me, friends] = await Promise.all([getProfile(userId), getFriends(userId)]);
  if (friends.length === 0) return [];
  const people = [...(me ? [me] : []), ...friends];

  const { data, error } = await supabase
    .from('quiz_answers')
    .select('user_id, quiz_date, question_id, is_correct')
    .in(
      'user_id',
      people.map((person) => person.id)
    );
  if (error) throw error;

  const byUser = new Map<string, Pick<QuizAnswer, 'quiz_date' | 'question_id' | 'is_correct'>[]>();
  for (const row of data ?? []) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({ quiz_date: row.quiz_date, question_id: row.question_id, is_correct: row.is_correct });
    byUser.set(row.user_id, list);
  }

  const today = todayQuizDate();
  return people
    .map((person) => {
      const answers = byUser.get(person.id) ?? [];
      const { current, best } = computeStreaks(answers, today);
      return {
        user: person,
        currentStreak: current,
        bestStreak: best,
        totalScore: computeScore(answers),
        answeredToday: answers.some((answer) => answer.quiz_date === today),
        isMe: person.id === userId,
      };
    })
    .sort(
      (a, b) =>
        b.currentStreak - a.currentStreak ||
        b.bestStreak - a.bestStreak ||
        profileDisplayName(a.user).localeCompare(profileDisplayName(b.user))
    );
}
