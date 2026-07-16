import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Purchases, {
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
} from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePremium } from '@/hooks/use-premium';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/db';
import { isPurchasesAvailable, PREMIUM_ENTITLEMENT_ID } from '@/lib/purchases';

const crownSource = require('../../assets/images/crown.png');

const BENEFITS: { icon?: keyof typeof Ionicons.glyphMap; crown?: boolean; title: string; text: string }[] = [
  {
    icon: 'remove-circle-outline',
    title: 'Sem anúncios',
    text: 'Navegue pelas suas séries e filmes sem nenhuma publicidade.',
  },
  {
    icon: 'repeat',
    title: 'Maratone de novo',
    text: 'Marque episódios, temporadas e filmes como vistos 2x, 3x ou quantas vezes quiser — e o tempo reassistido conta nas suas estatísticas.',
  },
  {
    icon: 'happy-outline',
    title: 'Avatares exclusivos',
    text: '24 avatares novos para deixar seu perfil com a sua cara.',
  },
  {
    crown: true,
    title: 'Coroa exclusiva no perfil',
    text: 'Uma coroa dourada no seu avatar, visível para os amigos no feed e nos comentários.',
  },
];

export default function PaywallScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isPremium, refresh } = usePremium();

  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPurchasesAvailable()) {
      setPackages([]);
      return;
    }
    Purchases.getOfferings()
      .then((offerings) => {
        const available = offerings.current?.availablePackages ?? [];
        setPackages(available);
        // Pré-seleciona o anual (melhor custo-benefício) quando existir.
        setSelected(available.find((p) => p.packageType === 'ANNUAL') ?? available[0] ?? null);
      })
      .catch((err) => setError(errorMessage(err, 'Não foi possível carregar os planos.')));
  }, []);

  async function buy() {
    if (!selected || buying) return;
    setBuying(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(selected);
      if (customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]) {
        await refresh();
        Alert.alert('Tudo certo!', 'Bem-vindo ao Next Episode Premium 🎉');
        router.back();
      }
    } catch (err: any) {
      // Cancelar a compra não é um erro para o usuário.
      if (err?.code !== PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR && !err?.userCancelled) {
        Alert.alert('Erro', errorMessage(err, 'Não foi possível concluir a compra.'));
      }
    } finally {
      setBuying(false);
    }
  }

  async function restore() {
    if (buying) return;
    setBuying(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      await refresh();
      if (customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]) {
        Alert.alert('Compras restauradas', 'Sua assinatura premium está ativa novamente.');
        router.back();
      } else {
        Alert.alert('Nada para restaurar', 'Não encontramos uma assinatura ativa nesta conta.');
      }
    } catch (err) {
      Alert.alert('Erro', errorMessage(err, 'Não foi possível restaurar as compras.'));
    } finally {
      setBuying(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={40} color={theme.gold} />
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Next Episode Premium
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.headerText}>
          Apoie o app e desbloqueie tudo isto:
        </ThemedText>
      </View>

      {BENEFITS.map((benefit) => (
        <View
          key={benefit.title}
          style={[styles.benefit, { backgroundColor: theme.backgroundElement }]}>
          {benefit.crown ? (
            <Image source={crownSource} contentFit="contain" style={styles.benefitCrown} />
          ) : (
            <Ionicons name={benefit.icon!} size={28} color={theme.accent} />
          )}
          <View style={styles.benefitTexts}>
            <ThemedText type="smallBold">{benefit.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {benefit.text}
            </ThemedText>
          </View>
        </View>
      ))}

      {isPremium ? (
        <View style={styles.status}>
          <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
          <ThemedText type="smallBold">Você já é assinante premium. Obrigado!</ThemedText>
        </View>
      ) : error ? (
        <ThemedText themeColor="danger" style={styles.message}>
          {error}
        </ThemedText>
      ) : packages === null ? (
        <ActivityIndicator style={styles.message} color={theme.accent} />
      ) : packages.length === 0 ? (
        <ThemedText themeColor="textSecondary" style={styles.message}>
          Os planos não estão disponíveis neste dispositivo no momento.
        </ThemedText>
      ) : (
        <>
          {packages.map((pkg) => {
            const active = selected?.identifier === pkg.identifier;
            return (
              <Pressable
                key={pkg.identifier}
                onPress={() => setSelected(pkg)}
                style={[
                  styles.plan,
                  { backgroundColor: theme.backgroundElement, borderColor: 'transparent' },
                  active && { borderColor: theme.accent, backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{planLabel(pkg)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {pkg.product.priceString}
                    {planPeriod(pkg)}
                  </ThemedText>
                </View>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={active ? theme.accent : theme.textSecondary}
                />
              </Pressable>
            );
          })}

          <Pressable
            onPress={buy}
            disabled={!selected || buying}
            style={[styles.buyButton, { backgroundColor: theme.accent, opacity: buying ? 0.6 : 1 }]}>
            {buying ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                Assinar premium
              </ThemedText>
            )}
          </Pressable>

          {/* A App Store exige oferecer a restauração de compras. */}
          <Pressable onPress={restore} disabled={buying} style={styles.restore}>
            <ThemedText type="link" themeColor="textSecondary">
              Restaurar compras
            </ThemedText>
          </Pressable>

          <ThemedText type="small" themeColor="textSecondary" style={styles.legal}>
            Assinatura renovada automaticamente; cancele quando quiser nos ajustes da sua conta da
            App Store. O valor é cobrado na confirmação da compra.
          </ThemedText>
        </>
      )}
    </ScrollView>
  );
}

/** Nome amigável do pacote (o RevenueCat manda tipos padronizados). */
function planLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'Anual';
    case 'MONTHLY':
      return 'Mensal';
    case 'WEEKLY':
      return 'Semanal';
    case 'LIFETIME':
      return 'Vitalício';
    default:
      return pkg.product.title || pkg.identifier;
  }
}

function planPeriod(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return ' por ano';
    case 'MONTHLY':
      return ' por mês';
    case 'WEEKLY':
      return ' por semana';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
  },
  headerText: {
    textAlign: 'center',
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
  },
  benefitTexts: {
    flex: 1,
    gap: Spacing.half,
  },
  // Mesma pegada dos ícones de 28px dos outros benefícios.
  benefitCrown: {
    width: 28,
    height: 20,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  message: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 2,
  },
  buyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    borderRadius: 12,
    marginTop: Spacing.two,
  },
  restore: {
    alignItems: 'center',
  },
  legal: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
});
