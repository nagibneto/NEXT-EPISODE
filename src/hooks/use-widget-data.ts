/**
 * Mantém os widgets em dia enquanto o app estiver aberto.
 *
 * São três momentos:
 *  - ao entrar nas abas, uma publicação inicial (limitada por tempo, para não
 *    repetir a varredura a cada volta de segundo plano);
 *  - ao voltar para o app, a fila de "assistido" marcado no widget é enviada
 *    ao Supabase;
 *  - ao ir para segundo plano, uma publicação imediata — é justamente quando o
 *    widget volta a aparecer na tela inicial.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import { flushWidgetRefresh, publishWidgetData, syncWidgetActions } from '@/lib/widget-data';

/** Intervalo mínimo entre duas publicações disparadas por "app em primeiro plano". */
const FOREGROUND_THROTTLE_MS = 10 * 60 * 1000;

let lastForegroundPublish = 0;

export function useWidgetData() {
  const { user } = useAuth();

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    async function onForeground(id: string) {
      // A sincronização vem primeiro: o payload publicado logo abaixo já sai
      // sem o episódio que o usuário marcou pelo widget.
      const changed = await syncWidgetActions(id).catch(() => false);
      if (!changed && Date.now() - lastForegroundPublish < FOREGROUND_THROTTLE_MS) return;
      lastForegroundPublish = Date.now();
      await publishWidgetData(id);
    }

    onForeground(userId);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') onForeground(userId);
      // 'inactive' no iOS é a central de controle / troca de app; só
      // 'background' significa que a tela inicial vai aparecer.
      else if (state === 'background') flushWidgetRefresh(userId);
    });

    return () => subscription.remove();
  }, [user?.id]);
}
