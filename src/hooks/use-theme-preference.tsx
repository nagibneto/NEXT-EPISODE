import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

/** Escolha do usuário; 'system' segue o modo claro/escuro do aparelho. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

interface ThemePreferenceValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Esquema efetivo depois de resolver 'system'. */
  scheme: 'light' | 'dark';
}

const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(undefined);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {});
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    // Persistir é melhor esforço; falha só significa voltar ao padrão no
    // próximo boot.
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const scheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  return (
    <ThemePreferenceContext.Provider value={{ preference, setPreference, scheme }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error('useThemePreference deve ser usado dentro de <ThemePreferenceProvider>');
  }
  return context;
}
