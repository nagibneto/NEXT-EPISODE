import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';
import {
  configurePurchases,
  hasPremiumEntitlement,
  isPurchasesAvailable,
  logOutPurchases,
} from '@/lib/purchases';

interface PremiumContextValue {
  /** Usuário tem a assinatura premium ativa? */
  isPremium: boolean;
  /** true enquanto o status inicial ainda não foi carregado. */
  loading: boolean;
  /** Reconsulta o status (ex.: depois de restaurar compras). */
  refresh: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextValue | undefined>(undefined);

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);

  async function fetchFromProfile(userId: string): Promise<boolean> {
    const { data } = await supabase
      .from('profiles')
      .select('is_premium')
      .eq('id', userId)
      .maybeSingle();
    return Boolean(data?.is_premium);
  }

  /**
   * Status combinado: o banco (webhook) OU o entitlement no RevenueCat — o
   * que estiver ativo vence. O entitlement cobre a janela logo depois da
   * compra, antes de o webhook gravar no banco; o banco cobre o web/Expo Go,
   * onde o SDK nativo não existe.
   */
  async function fetchPremium(userId: string): Promise<boolean> {
    if (await fetchFromProfile(userId)) return true;
    if (isPurchasesAvailable()) {
      try {
        return hasPremiumEntitlement(await Purchases.getCustomerInfo());
      } catch {
        // SDK ainda não configurado ou sem rede: vale o que o banco disse.
      }
    }
    return false;
  }

  async function refresh() {
    if (!user) {
      setIsPremium(false);
      return;
    }
    setIsPremium(await fetchPremium(user.id));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      if (!user) {
        setIsPremium(false);
        setLoading(false);
        await logOutPurchases();
        return;
      }
      try {
        // Configura antes para o fallback via entitlement funcionar.
        await configurePurchases(user.id);
        const premium = await fetchPremium(user.id);
        if (!cancelled) setIsPremium(premium);
      } catch {
        // Sem rede/SDK indisponível: mantém o último valor conhecido.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Depois de uma compra/restauração o SDK avisa na hora — o webhook até
    // atualiza o banco, mas o listener evita esperar essa volta.
    let remove: (() => void) | undefined;
    if (user && isPurchasesAvailable()) {
      const listener = (info: CustomerInfo) => {
        if (!cancelled) setIsPremium(hasPremiumEntitlement(info));
      };
      Purchases.addCustomerInfoUpdateListener(listener);
      remove = () => Purchases.removeCustomerInfoUpdateListener(listener);
    }

    return () => {
      cancelled = true;
      remove?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <PremiumContext.Provider value={{ isPremium, loading, refresh }}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  const context = useContext(PremiumContext);
  if (!context) throw new Error('usePremium deve ser usado dentro de <PremiumProvider>');
  return context;
}
