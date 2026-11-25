import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import {
  errorMessage,
  getLinkedGameAccount,
  linkGameAccount,
  unlinkGameAccount,
  type GamePlatform,
  type LinkedGameAccount,
} from '@/lib/db';
import { useEnabledPlatforms } from '@/lib/game-platforms';
import { importFullHistory, resetSync, syncLinkedAccounts } from '@/lib/game-sync';
import { resolvePsnProfile } from '@/lib/psn';
import { resolveSteamProfile } from '@/lib/steam';
import { resolveXboxProfile } from '@/lib/xbox';

/** Perfil encontrado, no formato comum às plataformas. */
interface FoundProfile {
  accountId: string;
  name: string;
  avatarUrl: string | null;
  isPublic: boolean;
  /** Linha extra (ex.: nível de troféus na PSN). */
  detail: string | null;
}

type LinkablePlatform = GamePlatform;

const PLATFORM_META: Record<
  LinkablePlatform,
  { title: string; icon: keyof typeof Ionicons.glyphMap; notFoundMessage: string }
> = {
  steam: { title: 'Steam', icon: 'logo-steam', notFoundMessage: 'Perfil da Steam não encontrado.' },
  psn: {
    title: 'PlayStation',
    icon: 'logo-playstation',
    notFoundMessage: 'ID da PSN não encontrado.',
  },
  xbox: { title: 'Xbox', icon: 'logo-xbox', notFoundMessage: 'Gamertag não encontrada.' },
};

/** Integrações não oficiais (podem quebrar sem aviso) ganham o selo "experimental". */
const EXPERIMENTAL: readonly LinkablePlatform[] = ['psn', 'xbox'];

/**
 * Contas de games: Steam, PlayStation e Xbox. A pessoa digita o perfil (sem
 * login), confere se é ela mesma e vincula. Depois disso a Biblioteca
 * sincroniza sozinha (src/lib/game-sync.ts).
 */
const PLATFORMS: readonly LinkablePlatform[] = ['steam', 'psn', 'xbox'];

export default function GameAccountsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  // Interruptor remoto: plataforma desligada no banco some da tela.
  const enabledPlatforms = useEnabledPlatforms();
  // Posição (y) de cada card na lista, para rolar até ele ao digitar.
  const cardY = useRef<Partial<Record<LinkablePlatform, number>>>({});

  // Espaço do tamanho do teclado no fim da lista: sem ele, o último card não
  // tem para onde subir e o campo fica escondido atrás do teclado (no
  // edge-to-edge a janela não encolhe quando o teclado abre).
  const keyboard = useAnimatedKeyboard();
  const keyboardSpacer = useAnimatedStyle(() => ({ height: keyboard.height.value }));

  function scrollToCard(platform: LinkablePlatform) {
    // Espera o teclado começar a subir para o espaço extra já existir.
    setTimeout(() => {
      const y = cardY.current[platform];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: y - Spacing.three, animated: true });
    }, 250);
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <ThemedText type="small" themeColor="textSecondary">
        {t('games.accounts.intro')}
      </ThemedText>

      {PLATFORMS.filter((platform) => enabledPlatforms?.has(platform) ?? true).map((platform) => (
        <View
          key={platform}
          onLayout={(event) => {
            cardY.current[platform] = event.nativeEvent.layout.y;
          }}>
          <AccountCard platform={platform} onInputFocus={() => scrollToCard(platform)} />
        </View>
      ))}

      <Animated.View style={keyboardSpacer} />
    </ScrollView>
  );
}

function AccountCard({
  platform,
  onInputFocus,
}: {
  platform: LinkablePlatform;
  /** Campo focado: a tela rola até o card para ele não ficar atrás do teclado. */
  onInputFocus?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const meta = PLATFORM_META[platform];

  // undefined = carregando; null = sem conta vinculada.
  const [account, setAccount] = useState<LinkedGameAccount | null | undefined>(undefined);
  // Perfil atual (nome/avatar/privacidade podem ter mudado desde o vínculo).
  const [liveProfile, setLiveProfile] = useState<FoundProfile | null>(null);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidate, setCandidate] = useState<FoundProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Importação do histórico em andamento: quantos jogos já foram casados.
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  async function resolve(value: string): Promise<FoundProfile> {
    if (platform === 'steam') {
      const profile = await resolveSteamProfile(value);
      return {
        accountId: profile.steamId,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        isPublic: profile.isPublic,
        detail: null,
      };
    }
    if (platform === 'xbox') {
      const profile = await resolveXboxProfile(value);
      return {
        accountId: profile.xuid,
        name: profile.gamertag,
        avatarUrl: profile.avatarUrl,
        isPublic: profile.isPublic,
        detail: t('games.xbox.gamerscoreTotal', { score: profile.gamerscore }),
      };
    }
    const profile = await resolvePsnProfile(value);
    return {
      accountId: profile.accountId,
      name: profile.onlineId,
      avatarUrl: profile.avatarUrl,
      isPublic: profile.isPublic,
      detail:
        profile.level !== null
          ? t('games.psn.level', { level: profile.level, platinum: profile.platinum ?? 0 })
          : null,
    };
  }

  useEffect(() => {
    if (!user) return;
    getLinkedGameAccount(user.id, platform)
      .then((linked) => {
        setAccount(linked);
        // PSN e Xbox buscam pelo nome (ID online/gamertag, em display_name);
        // a Steam, pelo SteamID.
        const lookup = platform === 'steam' ? linked?.account_id : linked?.display_name;
        if (lookup) {
          resolve(lookup)
            .then(setLiveProfile)
            .catch(() => {});
        }
      })
      .catch(() => setAccount(null));
    // resolve só depende de platform (e de t, para o texto do nível).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, platform]);

  async function handleSearch() {
    const value = input.trim();
    if (!value) return;
    Keyboard.dismiss();
    setError(null);
    setCandidate(null);
    // Espaço só aparece em apelido da Steam ("Fulano da Silva"), que não dá
    // para buscar — explica na hora em vez de mandar para a API.
    if (platform === 'steam' && /\s/.test(value) && !value.includes('steamcommunity.com')) {
      setError(t('games.steam.nicknameNotSupported'));
      return;
    }
    setSearching(true);
    try {
      setCandidate(await resolve(value));
    } catch (err) {
      const message = errorMessage(err, meta.notFoundMessage);
      setError(message === meta.notFoundMessage ? t(`games.${platform}.notFoundHelp`) : message);
    } finally {
      setSearching(false);
    }
  }

  async function handleLink(profile: FoundProfile) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const linked = {
        platform,
        account_id: profile.accountId,
        display_name: profile.name,
        avatar_url: profile.avatarUrl,
      };
      await linkGameAccount(user.id, linked);
      // Conta nova: a próxima sincronização traz os últimos 14 dias.
      await resetSync(user.id, platform);
      setAccount({ ...linked, linked_at: new Date().toISOString() });
      setLiveProfile(profile);
      setCandidate(null);
      setInput('');
      // Recém-vinculada: oferece trazer o histórico inteiro de uma vez.
      if (profile.isPublic) {
        Alert.alert(
          t('games.accounts.importOfferTitle'),
          t('games.accounts.importOfferBody', { platform: meta.title }),
          [
            { text: t('games.accounts.importLater'), style: 'cancel' },
            { text: t('games.accounts.importNow'), onPress: () => handleImportHistory() },
          ]
        );
      }
    } catch (err) {
      setError(errorMessage(err, t('games.accounts.linkError')));
    } finally {
      setBusy(false);
    }
  }

  function handleUnlink() {
    if (!user) return;
    Alert.alert(
      t('games.accounts.unlinkTitle', { platform: meta.title }),
      t('games.accounts.unlinkBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('games.accounts.unlink'),
          style: 'destructive',
          onPress: async () => {
            try {
              await unlinkGameAccount(user.id, platform);
              await resetSync(user.id, platform);
              setAccount(null);
              setLiveProfile(null);
            } catch (err) {
              setError(errorMessage(err, t('games.accounts.linkError')));
            }
          },
        },
      ]
    );
  }

  async function handleImportHistory() {
    if (!user) return;
    setError(null);
    setImporting({ done: 0, total: 0 });
    try {
      const result = await importFullHistory(user.id, platform, (done, total) =>
        setImporting({ done, total })
      );
      Alert.alert(
        t('games.accounts.importDoneTitle'),
        t('games.accounts.importDoneBody', {
          found: result.found,
          matched: result.matched,
          added: result.added,
        })
      );
    } catch (err) {
      setError(errorMessage(err, t('games.accounts.syncError')));
    } finally {
      setImporting(null);
    }
  }

  async function handleSyncNow() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const added = await syncLinkedAccounts(user.id, { platform, force: true, allRecent: true });
      Alert.alert(
        t('games.accounts.syncTitle', { platform: meta.title }),
        added > 0 ? t('games.accounts.syncDone', { count: added }) : t('games.accounts.syncAlready')
      );
    } catch (err) {
      setError(errorMessage(err, t('games.accounts.syncError')));
    } finally {
      setBusy(false);
    }
  }

  const shown: FoundProfile | null =
    liveProfile ??
    (account
      ? {
          accountId: account.account_id,
          name: account.display_name ?? account.account_id,
          avatarUrl: account.avatar_url,
          isPublic: true,
          detail: null,
        }
      : null);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardTitle}>
        <Ionicons name={meta.icon} size={22} color={theme.text} />
        <ThemedText type="smallBold">{meta.title}</ThemedText>
        {EXPERIMENTAL.includes(platform) && (
          <View style={[styles.tag, { borderColor: theme.textSecondary }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tagText}>
              {t('games.accounts.experimental')}
            </ThemedText>
          </View>
        )}
      </View>

      {account === undefined ? (
        <ActivityIndicator />
      ) : account && shown ? (
        <>
          <ProfileRow platform={platform} profile={shown} />
          {liveProfile && !liveProfile.isPublic && <PrivacyHelp platform={platform} />}
          <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
            {t(`games.${platform}.syncHint`)}
          </ThemedText>
          <Pressable
            disabled={busy || importing !== null}
            style={[styles.button, { backgroundColor: theme.background, opacity: busy ? 0.6 : 1 }]}
            onPress={handleSyncNow}>
            {busy ? (
              <ActivityIndicator />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {t('games.accounts.syncNow')}
              </ThemedText>
            )}
          </Pressable>
          <Pressable
            disabled={busy || importing !== null}
            style={[
              styles.button,
              { backgroundColor: theme.background, opacity: importing ? 0.8 : 1 },
            ]}
            onPress={handleImportHistory}>
            {importing ? (
              <View style={styles.inline}>
                <ActivityIndicator size="small" />
                <ThemedText type="small" themeColor="textSecondary">
                  {importing.total > 0
                    ? t('games.accounts.importProgress', {
                        done: importing.done,
                        total: importing.total,
                      })
                    : t('games.accounts.importStarting')}
                </ThemedText>
              </View>
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {t('games.accounts.importHistory')}
              </ThemedText>
            )}
          </Pressable>
          <Pressable hitSlop={8} onPress={handleUnlink} style={styles.unlink}>
            <ThemedText type="small" themeColor="danger">
              {t('games.accounts.unlink')}
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <View style={[styles.inputWrap, { backgroundColor: theme.background }]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder={t(`games.${platform}.placeholder`)}
              placeholderTextColor={theme.textSecondary}
              value={input}
              onChangeText={setInput}
              onFocus={onInputFocus}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searching ? (
              <ActivityIndicator size="small" />
            ) : (
              <Pressable hitSlop={8} onPress={handleSearch} disabled={!input.trim()}>
                <Ionicons name="search" size={18} color={theme.accent} />
              </Pressable>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
            {t(`games.${platform}.whereToFind`)}
          </ThemedText>

          {candidate && (
            <View style={[styles.candidate, { borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('games.accounts.isThisYou')}
              </ThemedText>
              <ProfileRow platform={platform} profile={candidate} />
              {!candidate.isPublic && <PrivacyHelp platform={platform} />}
              <Pressable
                disabled={busy}
                style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
                onPress={() => handleLink(candidate)}>
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  {t('games.accounts.link')}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </>
      )}
      {error && (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function ProfileRow({ platform, profile }: { platform: LinkablePlatform; profile: FoundProfile }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.profileRow}>
      {profile.avatarUrl ? (
        <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]} />
      )}
      <View style={styles.profileText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {profile.name}
        </ThemedText>
        {profile.detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {profile.detail}
          </ThemedText>
        ) : null}
        <View style={styles.inline}>
          <Ionicons
            name={profile.isPublic ? 'checkmark-circle' : 'lock-closed'}
            size={13}
            color={profile.isPublic ? theme.accent : theme.goldText}
          />
          <ThemedText
            type="small"
            style={{ color: profile.isPublic ? theme.textSecondary : theme.goldText }}>
            {profile.isPublic ? t(`games.${platform}.public`) : t(`games.${platform}.private`)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

/** Passo a passo para abrir a privacidade na plataforma. */
function PrivacyHelp({ platform }: { platform: LinkablePlatform }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.help, { borderColor: theme.goldText }]}>
      <ThemedText type="small" style={{ color: theme.goldText }}>
        {t(`games.${platform}.privacyHelp`)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
  },
  tagText: {
    fontSize: 11,
    lineHeight: 16,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  small: {
    fontSize: 12,
    lineHeight: 17,
  },
  candidate: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  help: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.two,
  },
  button: {
    borderRadius: Radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unlink: {
    alignSelf: 'center',
    paddingVertical: Spacing.one,
  },
});
