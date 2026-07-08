import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Indica se as variáveis do Supabase foram preenchidas no .env.
 * Quando falso, o app ainda abre e a tela de login orienta a configuração
 * (em vez de quebrar na inicialização).
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://nao-configurado.supabase.co',
  supabaseAnonKey || 'chave-nao-configurada',
  {
    auth: {
      // No web (incluindo a renderização estática do Expo) o supabase-js usa
      // localStorage com verificações próprias; AsyncStorage só no nativo.
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No web, deixa o supabase-js capturar o token da URL ao voltar do link
      // de confirmação por e-mail. No nativo isso é feito manualmente via
      // deep link (veja use-auth.tsx), por isso fica desligado aqui.
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);
