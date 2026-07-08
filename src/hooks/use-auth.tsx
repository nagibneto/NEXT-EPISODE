import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Extrai access_token/refresh_token de um deep link de confirmação de e-mail
 * (o Supabase manda esses dados no fragmento "#..." da URL de redirect) e
 * abre a sessão. No nativo o app não passa pelo navegador para processar a
 * URL sozinho, então isso precisa ser feito manualmente.
 */
async function applySessionFromUrl(url: string | null) {
  if (!url) return;
  const fragment = url.split('#')[1];
  if (!fragment) return;
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return;
  await supabase.auth.setSession({ access_token, refresh_token });
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName?: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    // No nativo, captura o token quando o app é aberto pelo link de
    // confirmação de e-mail (app já aberto ou aberto a partir do link).
    let linkSubscription: { remove: () => void } | undefined;
    if (Platform.OS !== 'web') {
      Linking.getInitialURL().then(applySessionFromUrl);
      linkSubscription = Linking.addEventListener('url', ({ url }) => applySessionFromUrl(url));
    }

    return () => {
      subscription.subscription.unsubscribe();
      linkSubscription?.remove();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string, username: string, displayName?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName?.trim() || username },
        // Para onde o Supabase manda o usuário depois de confirmar o
        // e-mail. Precisa estar na lista de "Redirect URLs" do painel do
        // Supabase (Authentication → URL Configuration), senão o link cai
        // no Site URL padrão (geralmente localhost) e parece "não abrir nada".
        emailRedirectTo: Linking.createURL('/login'),
      },
    });
    if (error) throw error;
    // Com e-mail já cadastrado o Supabase devolve "sucesso" sem identidades
    // (proteção contra enumeração de e-mails) — avisamos o usuário de verdade.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('Este e-mail já está cadastrado. Use "Faça login" para entrar.');
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return context;
}
