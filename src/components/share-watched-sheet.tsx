import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import RNShare, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import { ActionSheet } from '@/components/action-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SITE_URL = 'nextepisode.com.br';
const SITE_URL_FULL = 'https://nextepisode.com.br';
const APP_LOGO = require('../../assets/images/logo.png');

// Só o link clicável no Instagram Stories depende disso — sem ele o app cai
// direto na folha de compartilhar nativa, sem o atalho do Instagram (ver
// EXPO_PUBLIC_FACEBOOK_APP_ID em .env.example).
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

async function isInstagramAvailable() {
  if (!FACEBOOK_APP_ID) return false;
  try {
    if (Platform.OS === 'android') {
      const result = await RNShare.isPackageInstalled('com.instagram.android');
      return result.isInstalled;
    }
    return await Linking.canOpenURL('instagram-stories://share');
  } catch {
    return false;
  }
}

/**
 * Modal de "conquista" mostrado ao marcar o último episódio de uma
 * temporada/série ou um filme como assistido, convidando a compartilhar um
 * cartão com o resultado. A captura usa `Image` nativo (não `expo-image`)
 * porque é o que o `react-native-view-shot` sabe capturar de forma confiável.
 */
export function ShareWatchedSheet({
  visible,
  onClose,
  imageUrl,
  badgeLabel,
  title,
  subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  imageUrl: string | null;
  badgeLabel: string;
  title: string;
  subtitle?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const cardRef = useRef<View>(null);
  const [imageLoaded, setImageLoaded] = useState(!imageUrl);
  const [preparing, setPreparing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const capturedUri = useRef<string | null>(null);

  async function shareGeneric(uri: string) {
    try {
      await RNShare.open({
        url: uri,
        message: t('shareWatchedSheet.shareText', { title }),
        title,
        failOnCancel: false,
      });
    } catch {
      // Usuário cancelou o compartilhamento — sem tratamento.
    }
  }

  async function shareInstagramStories(uri: string) {
    if (!FACEBOOK_APP_ID) return;
    try {
      await RNShare.shareSingle({
        social: Social.InstagramStories,
        appId: FACEBOOK_APP_ID,
        backgroundImage: uri,
        linkUrl: SITE_URL_FULL,
        linkText: SITE_URL,
      });
    } catch {
      // Instagram pode não estar instalado, ou o usuário cancelou.
    }
  }

  async function handleShare() {
    if (preparing) return;
    setPreparing(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 0.92, result: 'tmpfile' });
      if (await isInstagramAvailable()) {
        capturedUri.current = uri;
        setPickerVisible(true);
      } else {
        await shareGeneric(uri);
      }
    } catch {
      // Captura da imagem falhou — sem tratamento.
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.wrapper, { backgroundColor: theme.backgroundElement }]}>
          <View
            ref={cardRef}
            collapsable={false}
            style={[styles.card, { backgroundColor: theme.backgroundSelected }]}>
            {imageUrl && (
              <Image
                source={{ uri: imageUrl }}
                style={styles.cardImage}
                resizeMode="cover"
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageLoaded(true)}
              />
            )}
            <View style={styles.cardOverlay} />
            <View style={styles.cardContent}>
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <Ionicons name="checkmark-circle" size={16} color={theme.accentText} />
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  {badgeLabel}
                </ThemedText>
              </View>
              <View style={styles.cardText}>
                <ThemedText type="subtitle" style={styles.cardTitle} numberOfLines={2}>
                  {title}
                </ThemedText>
                {subtitle ? (
                  <ThemedText style={styles.cardSubtitle} numberOfLines={2}>
                    {subtitle}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.brandRow}>
                <Image source={APP_LOGO} style={styles.brandLogo} resizeMode="contain" />
                <ThemedText type="smallBold" style={styles.brandText}>
                  {SITE_URL}
                </ThemedText>
              </View>
            </View>
            {!imageLoaded && (
              <View style={styles.cardLoading}>
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
          </View>

          <Pressable
            style={[
              styles.shareButton,
              { backgroundColor: theme.accent, opacity: !imageLoaded || preparing ? 0.6 : 1 },
            ]}
            disabled={!imageLoaded || preparing}
            onPress={handleShare}>
            {preparing ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <>
                <Ionicons name="share-social" size={18} color={theme.accentText} />
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  {t('common.share')}
                </ThemedText>
              </>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.notNow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
            ]}
            onPress={onClose}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('shareWatchedSheet.notNow')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
      <ActionSheet
        visible={pickerVisible}
        title={t('shareWatchedSheet.pickAppTitle')}
        onClose={() => setPickerVisible(false)}
        options={[
          {
            label: t('shareWatchedSheet.instagramStories'),
            icon: 'logo-instagram',
            accent: true,
            onPress: () => {
              if (capturedUri.current) shareInstagramStories(capturedUri.current);
            },
          },
          {
            label: t('shareWatchedSheet.moreApps'),
            icon: 'share-social-outline',
            onPress: () => {
              if (capturedUri.current) shareGeneric(capturedUri.current);
            },
          },
        ]}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  wrapper: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
    padding: Spacing.four,
  },
  badge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: Spacing.two,
  },
  cardText: {
    gap: Spacing.one,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 30,
  },
  cardSubtitle: {
    color: '#ffffff',
    opacity: 0.9,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  brandLogo: {
    width: 22,
    height: 22,
    borderRadius: 5,
  },
  brandText: {
    color: '#ffffff',
  },
  cardLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingVertical: 14,
  },
  notNow: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 14,
  },
});
