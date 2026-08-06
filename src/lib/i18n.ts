/**
 * Instância singleton do i18next. Importar diretamente `i18n` (não o hook
 * `useTranslation`) nos módulos fora de componentes React — ex.: tmdb.ts,
 * relative-date.ts, notifications.ts — porque eles não têm acesso ao contexto
 * do React. O idioma ativo é definido por useLanguagePreference via
 * `i18n.changeLanguage(...)`.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUS from '@/locales/en-US';
import ptBR from '@/locales/pt-BR';

export type AppLanguage = 'pt-BR' | 'en-US';

export const SUPPORTED_LANGUAGES: AppLanguage[] = ['pt-BR', 'en-US'];
export const DEFAULT_LANGUAGE: AppLanguage = 'pt-BR';

i18next.use(initReactI18next).init({
  resources: {
    'pt-BR': { translation: ptBR },
    'en-US': { translation: enUS },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export const i18n = i18next;
