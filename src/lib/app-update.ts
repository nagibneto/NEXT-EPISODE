/**
 * Modal "atualize o app": decide se aparece e monta a lista do que mudou
 * desde a versão instalada.
 *
 * As versões vêm da tabela app_releases (ver supabase/schema.sql) — o app
 * instalado não tem como conhecer o changelog de uma versão que saiu depois
 * dele. Para anunciar um lançamento, basta inserir a linha lá; nada aqui
 * precisa mudar.
 *
 * O "já dispensei" fica no aparelho (AsyncStorage) e não na conta, de
 * propósito: atualizar é por aparelho. Quem tem celular e tablet precisa ver
 * o aviso nos dois.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { compareVersions, currentAppVersion } from './app-version';
import { i18n, DEFAULT_LANGUAGE } from './i18n';
import { supabase } from './supabase';

/**
 * Chave para ligar o modal. Enquanto estiver false nada aparece, mesmo com
 * linhas em app_releases — é o interruptor para soltar o aviso quando quiser
 * (mudança só de JS, sai por OTA update).
 */
export const UPDATE_PROMPT_ENABLED = false;

/** Dispensou o aviso? Volta a aparecer depois disto. */
const SNOOZE_DAYS = 3;

/** Quantas versões e quantos itens no máximo o modal lista. */
const MAX_VERSIONS = 3;
const MAX_HIGHLIGHTS = 8;

const SNOOZE_KEY = 'app-update-prompt:snoozed-until';

interface AppRelease {
  version: string;
  platform: 'ios' | 'android' | null;
  mandatory: boolean;
  highlights: Record<string, string[]> | null;
}

/** As melhorias de uma versão, já no idioma ativo. */
export interface ReleaseHighlights {
  version: string;
  items: string[];
}

export interface PendingUpdate {
  /** A versão mais nova disponível na loja desta plataforma. */
  latestVersion: string;
  /** Sem "agora não": alguma das versões pendentes é obrigatória. */
  mandatory: boolean;
  /** Da mais nova para a mais antiga, só as posteriores à instalada. */
  highlights: ReleaseHighlights[];
}

/** Traduções da versão no idioma ativo, com pt-BR como rede de segurança. */
function localizedHighlights(release: AppRelease): string[] {
  const byLanguage = release.highlights ?? {};
  const items =
    byLanguage[i18n.language] ??
    byLanguage[DEFAULT_LANGUAGE] ??
    Object.values(byLanguage)[0] ??
    [];
  return Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item) : [];
}

/**
 * Busca em app_releases o que é mais novo que a versão instalada. Devolve null
 * quando já está em dia (o caso normal) — e também quando a consulta falha,
 * porque um aviso de atualização nunca vale uma tela de erro.
 */
export async function fetchPendingUpdate(): Promise<PendingUpdate | null> {
  const installed = currentAppVersion();
  if (!installed) return null;

  const { data, error } = await supabase
    .from('app_releases')
    .select('version, platform, mandatory, highlights')
    .or(`platform.is.null,platform.eq.${Platform.OS}`)
    .order('released_at', { ascending: false })
    .limit(20);
  if (error || !data) return null;

  const pending = (data as AppRelease[])
    .filter((release) => compareVersions(release.version, installed) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (pending.length === 0) return null;

  const highlights: ReleaseHighlights[] = [];
  let total = 0;
  for (const release of pending.slice(0, MAX_VERSIONS)) {
    const items = localizedHighlights(release).slice(0, MAX_HIGHLIGHTS - total);
    if (items.length === 0) continue;
    highlights.push({ version: release.version, items });
    total += items.length;
    if (total >= MAX_HIGHLIGHTS) break;
  }

  return {
    latestVersion: pending[0].version,
    mandatory: pending.some((release) => release.mandatory),
    highlights,
  };
}

let pendingCheck: Promise<PendingUpdate | null> | null = null;

/**
 * fetchPendingUpdate() com resultado guardado para a sessão inteira. Dois
 * interessados na mesma resposta — o modal de atualização e o de avaliação,
 * que se cala enquanto houver versão nova — e uma consulta só.
 */
export function pendingUpdateOnce(): Promise<PendingUpdate | null> {
  pendingCheck ??= fetchPendingUpdate();
  return pendingCheck;
}

/** Já passou do prazo do "agora não"? */
export async function isUpdatePromptSnoozed(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SNOOZE_KEY).catch(() => null);
  if (!raw) return false;
  const until = Date.parse(raw);
  return Number.isFinite(until) && until > Date.now();
}

/** Guarda o "agora não" por SNOOZE_DAYS dias. */
export async function snoozeUpdatePrompt() {
  const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await AsyncStorage.setItem(SNOOZE_KEY, until).catch(() => {});
}
