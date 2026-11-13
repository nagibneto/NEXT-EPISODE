import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { skipQuizDayPrompt } from '@/components/quiz-day-prompt';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { getCampaignDelivery, markCampaignSeen } from '@/lib/db';
import { acquireStartupPrompt, releaseStartupPrompt } from '@/lib/startup-prompts';

/**
 * Chave do tutorial em campaign_deliveries. Para mostrar o tutorial de novo a
 * todo mundo (ex.: depois de uma mudança grande no app), troque por uma chave
 * nova — e mude NEW_ACCOUNT_DAYS se a regra de "conta nova" também mudar.
 */
export const TUTORIAL_KEY = 'tutorial-v1';

/**
 * Até quantos dias de conta o tutorial aparece sozinho. Além disso, ele só
 * aparece para quem tiver um convite gravado à mão (linha em
 * campaign_deliveries com seen_at nulo — ver NOTIFICACOES-CAMPANHAS.md).
 */
const NEW_ACCOUNT_DAYS = 7;

// Uma tentativa por sessão; se a marcação falhar (sem rede), tenta na próxima abertura.
let checkedThisSession = false;

type SlideKey = 'welcome' | 'add' | 'track' | 'remind' | 'quiz' | 'friends';

interface Slide {
  key: SlideKey;
  icon: keyof typeof Ionicons.glyphMap | 'logo';
  /** Cor do ícone e do halo: azul para "como fazer", amarelo para o que é novidade. */
  tone: 'accent' | 'gold';
}

const SLIDES: Slide[] = [
  { key: 'welcome', icon: 'logo', tone: 'gold' },
  { key: 'add', icon: 'add', tone: 'accent' },
  { key: 'track', icon: 'checkmark-done', tone: 'accent' },
  { key: 'remind', icon: 'notifications', tone: 'gold' },
  { key: 'quiz', icon: 'flame', tone: 'gold' },
  { key: 'friends', icon: 'people', tone: 'accent' },
];

/**
 * Tutorial de boas-vindas: seis telas que passam de lado, mostradas uma única
 * vez para contas novas. Fica no layout das abas e entra primeiro na fila de
 * avisos de abertura (ver startup-prompts.ts) — a vaga é pega já na montagem,
 * antes do modal do quiz e do banner de campanha consultarem o banco.
 */
export function TutorialPrompt() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  useEffect(() => {
    if (!user || checkedThisSession) return;
    checkedThisSession = true;
    let cancelled = false;
    let holding = true;
    // Pega a vaga antes de qualquer consulta: os outros avisos esperam até
    // sabermos se o tutorial vai aparecer.
    const slot = acquireStartupPrompt();
    const release = () => {
      if (!holding) return;
      holding = false;
      slot.then(releaseStartupPrompt);
    };

    (async () => {
      try {
        const delivery = await getCampaignDelivery(user.id, TUTORIAL_KEY);
        const ageDays = (Date.now() - Date.parse(user.created_at)) / 86_400_000;
        const invited = delivery !== null && !delivery.seen;
        const isNew = delivery === null && ageDays <= NEW_ACCOUNT_DAYS;
        if (cancelled) {
          // Desmontou antes de decidir: a próxima montagem verifica de novo.
          checkedThisSession = false;
          release();
          return;
        }
        if (!(invited || isNew)) {
          release();
          return;
        }
        // Marca antes de mostrar (mesma lógica do banner de campanha): fechar o
        // app com o tutorial aberto não o faz voltar.
        await markCampaignSeen(user.id, TUTORIAL_KEY);
        await slot;
        if (cancelled) {
          release();
          return;
        }
        // O tutorial já apresenta o quiz; o modal "o quiz de hoje chegou" logo
        // em seguida seria repetição.
        skipQuizDayPrompt();
        setVisible(true);
      } catch {
        // Sem rede: tenta de novo na próxima abertura.
        checkedThisSession = false;
        release();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function close() {
    setVisible(false);
    releaseStartupPrompt();
  }

  function goTo(next: number) {
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(Math.max(0, Math.min(next, SLIDES.length - 1)));
  }

  const isLast = index === SLIDES.length - 1;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}>
        <View style={styles.topBar}>
          {!isLast ? (
            <Pressable hitSlop={12} onPress={close}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('tutorial.skip')}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(slide) => slide.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => {
            const color = item.tone === 'gold' ? theme.gold : theme.accent;
            return (
              <View style={[styles.slide, { width }]}>
                {/* Halo em três anéis da cor do slide: o "brilho" sem depender de blur. */}
                <View style={[styles.haloOuter, { backgroundColor: `${color}12` }]}>
                  <View style={[styles.haloMiddle, { backgroundColor: `${color}22` }]}>
                    <View style={[styles.haloInner, { backgroundColor: `${color}33` }]}>
                      {item.icon === 'logo' ? (
                        <Image
                          source={require('../../assets/images/logo.png')}
                          style={styles.logo}
                          contentFit="contain"
                        />
                      ) : (
                        <Ionicons name={item.icon} size={48} color={color} />
                      )}
                    </View>
                  </View>
                </View>
                <ThemedText style={styles.title}>{t(`tutorial.slides.${item.key}.title`)}</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.body}>
                  {t(`tutorial.slides.${item.key}.body`)}
                </ThemedText>
              </View>
            );
          }}
        />

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((slide, i) => (
              <View
                key={slide.key}
                style={[
                  styles.dot,
                  i === index
                    ? [styles.dotActive, { backgroundColor: theme.accent }]
                    : { backgroundColor: theme.backgroundSelected },
                ]}
              />
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => (isLast ? close() : goTo(index + 1))}>
            <ThemedText type="smallBold" style={[styles.primaryLabel, { color: theme.accentText }]}>
              {isLast ? t('tutorial.start') : t('tutorial.next')}
            </ThemedText>
          </Pressable>
          {/* Na última tela, o atalho para o que ela acabou de sugerir. */}
          <Pressable
            style={[styles.secondary, !isLast && styles.hidden]}
            disabled={!isLast}
            onPress={() => {
              close();
              router.push('/friends');
            }}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {t('tutorial.findFriends')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  haloOuter: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.four,
  },
  haloMiddle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  haloInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
  },
  title: {
    fontFamily: 'Poppins_600SemiBold',
    // O peso vem do próprio arquivo da fonte (ver app-header.tsx).
    fontWeight: 'normal',
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 340,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: Spacing.three,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    width: 22,
  },
  primary: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    paddingVertical: 16,
  },
  primaryLabel: {
    fontSize: 16,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  // Esconde sem tirar do layout: os botões não pulam ao chegar na última tela.
  hidden: {
    opacity: 0,
  },
});
