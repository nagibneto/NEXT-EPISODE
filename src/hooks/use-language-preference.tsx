import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { updateLanguage } from '@/lib/db';
import { i18n, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, type AppLanguage } from '@/lib/i18n';
import { setTmdbLanguage } from '@/lib/tmdb';

/** Escolha do usuário; 'system' segue o idioma do aparelho. */
export type LanguagePreference = 'system' | AppLanguage;

const STORAGE_KEY = 'language-preference';

function resolveSystemLanguage(): AppLanguage {
  const code = Localization.getLocales()[0]?.languageCode;
  // Compara só o idioma (ignora região do aparelho, ex.: en-GB, en-CA) — só
  // 'pt-BR' e 'en-US' existem como conteúdo, então qualquer variante de
  // inglês cai em 'en-US' e o restante fica no padrão pt-BR.
  if (code === 'en') return 'en-US';
  return DEFAULT_LANGUAGE;
}

interface LanguagePreferenceValue {
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  /** Idioma efetivo depois de resolver 'system'. */
  language: AppLanguage;
}

const LanguagePreferenceContext = createContext<LanguagePreferenceValue | undefined>(undefined);

export function LanguagePreferenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preference, setPreferenceState] = useState<LanguagePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'system' || SUPPORTED_LANGUAGES.some((lang) => lang === stored)) {
          setPreferenceState(stored as LanguagePreference);
        }
      })
      .catch(() => {});
  }, []);

  function setPreference(next: LanguagePreference) {
    setPreferenceState(next);
    // Persistir é melhor esforço; falha só significa voltar ao padrão no
    // próximo boot.
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const language = preference === 'system' ? resolveSystemLanguage() : preference;

  useEffect(() => {
    i18n.changeLanguage(language);
    setTmdbLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!user) return;
    // Melhor esforço: as Edge Functions de push leem esse campo para
    // notificar no idioma certo. Falha aqui não deve travar a troca local.
    updateLanguage(user.id, language).catch(() => {});
  }, [user, language]);

  return (
    <LanguagePreferenceContext.Provider value={{ preference, setPreference, language }}>
      {children}
    </LanguagePreferenceContext.Provider>
  );
}

export function useLanguagePreference() {
  const context = useContext(LanguagePreferenceContext);
  if (!context) {
    throw new Error('useLanguagePreference deve ser usado dentro de <LanguagePreferenceProvider>');
  }
  return context;
}
