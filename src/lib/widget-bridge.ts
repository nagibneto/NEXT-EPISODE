/**
 * Transporte entre o app e os widgets — versão vazia.
 *
 * Metro escolhe widget-bridge.ios.ts / widget-bridge.android.ts nas
 * plataformas que têm widget; este arquivo atende o restante (web e o
 * navegador do Expo), onde não existe tela inicial para colocar widget.
 */

import type { PendingWatchedEvent, WidgetPayload } from './widget-data';

export async function writeWidgetPayload(_payload: WidgetPayload): Promise<void> {}

export async function clearWidgetStorage(_strings: Record<string, string>): Promise<void> {}

export async function claimPendingWatched(): Promise<PendingWatchedEvent[]> {
  return [];
}

export async function restorePendingWatched(_events: PendingWatchedEvent[]): Promise<void> {}

export async function clearConsumedWatched(): Promise<void> {}

export function describeWidgetStorage(): string {
  return 'plataforma sem widget';
}
