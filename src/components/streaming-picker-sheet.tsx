import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { getStreamingServices, setStreamingServices } from '@/lib/db';
import { getAllStreamingProviders, providerLogoUrl, type TmdbWatchProvider } from '@/lib/tmdb';

/**
 * Folha para o usuário marcar os streamings que assina. Carrega e salva
 * sozinha (tabela streaming_services); quem abre só recebe o resultado em
 * `onSaved`. Usada na aba "Para você" e no Perfil.
 */
export function StreamingPickerSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved?: (providerIds: number[]) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [providers, setProviders] = useState<TmdbWatchProvider[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !user) return;
    let cancelled = false;
    setProviders(null);
    Promise.all([getAllStreamingProviders(), getStreamingServices(user.id).catch(() => [])]).then(
      ([all, mine]) => {
        if (cancelled) return;
        setProviders(all);
        setSelected(mine);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [visible, user]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      await setStreamingServices(user.id, selected);
      onSaved?.(selected);
      onClose();
    } catch {
      Alert.alert(t('discover.picker.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <ThemedText type="subtitle" style={styles.title}>
            {t('discover.picker.title')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {t('discover.picker.subtitle')}
          </ThemedText>
          {providers === null ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.grid}>
                {providers.map((provider) => {
                  const isSelected = selected.includes(provider.provider_id);
                  const logo = providerLogoUrl(provider.logo_path);
                  return (
                    <Pressable
                      key={provider.provider_id}
                      style={styles.cell}
                      onPress={() => toggle(provider.provider_id)}>
                      <View
                        style={[
                          styles.logoWrap,
                          { borderColor: isSelected ? theme.accent : 'transparent' },
                        ]}>
                        {logo ? (
                          <Image source={{ uri: logo }} style={styles.logo} cachePolicy="memory-disk" />
                        ) : (
                          <View style={[styles.logo, { backgroundColor: theme.backgroundSelected }]} />
                        )}
                        {isSelected ? (
                          <View style={[styles.check, { backgroundColor: theme.accent }]}>
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          </View>
                        ) : null}
                      </View>
                      <ThemedText
                        type="small"
                        numberOfLines={2}
                        themeColor={isSelected ? 'text' : 'textSecondary'}
                        style={styles.cellLabel}>
                        {provider.provider_name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
          <Pressable
            style={[styles.save, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}
            disabled={saving || providers === null}
            onPress={handleSave}>
            {saving ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                {selected.length > 0
                  ? t('discover.picker.saveCount', { count: selected.length })
                  : t('discover.picker.save')}
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.three,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  loading: {
    marginVertical: Spacing.five,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
  },
  cell: {
    width: '25%',
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
  },
  logoWrap: {
    borderWidth: 2,
    borderRadius: Radius.xl + 2,
    padding: 2,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: Radius.xl,
  },
  check: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabel: {
    marginTop: Spacing.one,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  save: {
    marginTop: Spacing.three,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
