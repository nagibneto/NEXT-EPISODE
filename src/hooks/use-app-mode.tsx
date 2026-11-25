import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Lado do app que está à mostra: séries/filmes (TMDB) ou games (IGDB). O
 * seletor fica no header das abas (ModeToggle em app-header.tsx) e as abas
 * Início, Watchlist, Para você e Buscar trocam de conteúdo conforme o modo.
 */
export type AppMode = 'watch' | 'games';

const STORAGE_KEY = 'app-mode';

interface AppModeValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeValue | undefined>(undefined);

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('watch');

  // Abre no último modo usado.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'watch' || stored === 'games') setModeState(stored);
      })
      .catch(() => {});
  }, []);

  function setMode(next: AppMode) {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  return <AppModeContext.Provider value={{ mode, setMode }}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const context = useContext(AppModeContext);
  if (!context) throw new Error('useAppMode deve ser usado dentro de <AppModeProvider>');
  return context;
}
