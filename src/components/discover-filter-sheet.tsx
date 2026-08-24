import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { YearRangeSlider } from '@/components/year-range-slider';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TmdbGenre } from '@/lib/tmdb';

export interface YearRange {
  from: number;
  to: number;
}

/** Antes disso o catálogo do TMDB é raso demais para valer um passo no slider. */
export const MIN_YEAR = 1950;
/** Um ano à frente para alcançar estreias já anunciadas. */
export const MAX_YEAR = new Date().getFullYear() + 1;

interface DiscoverFilterSheetProps {
  visible: boolean;
  genres: TmdbGenre[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
  /** Só informando `onYearChange` o sheet ganha a aba de ano. */
  yearRange?: YearRange | null;
  onYearChange?: (range: YearRange | null) => void;
}

type Tab = 'genre' | 'year';

/** Bottom sheet para filtrar as listas por categoria/gênero e por ano do TMDB. */
export function DiscoverFilterSheet({
  visible,
  genres,
  selectedId,
  onSelect,
  onClose,
  yearRange,
  onYearChange,
}: DiscoverFilterSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('genre');
  // Rascunho do intervalo: arrastar não refaz a busca a cada quadro, só o
  // "Aplicar" (ou um atalho) confirma a escolha.
  const [draft, setDraft] = useState<YearRange>({ from: MIN_YEAR, to: MAX_YEAR });

  // Ao reabrir, o slider volta a mostrar o filtro que está valendo.
  useEffect(() => {
    if (visible) setDraft(yearRange ?? { from: MIN_YEAR, to: MAX_YEAR });
  }, [visible, yearRange]);

  function chooseGenre(id: number | null) {
    onSelect(id);
    onClose();
  }

  function applyYears(range: YearRange) {
    // A faixa inteira equivale a não filtrar nada.
    onYearChange?.(range.from === MIN_YEAR && range.to === MAX_YEAR ? null : range);
    onClose();
  }

  const thisYear = new Date().getFullYear();
  const presets: { label: string; range: YearRange }[] = [
    { label: t('filterSheet.thisYear'), range: { from: thisYear, to: thisYear } },
    { label: t('filterSheet.lastFiveYears'), range: { from: thisYear - 4, to: thisYear } },
    { label: t('filterSheet.decade', { decade: '2020' }), range: { from: 2020, to: 2029 } },
    { label: t('filterSheet.decade', { decade: '2010' }), range: { from: 2010, to: 2019 } },
    { label: t('filterSheet.decade', { decade: '2000' }), range: { from: 2000, to: 2009 } },
    { label: t('filterSheet.decade', { decade: '90' }), range: { from: 1990, to: 1999 } },
  ];

  const draftLabel =
    draft.from === MIN_YEAR && draft.to === MAX_YEAR
      ? t('filterSheet.anyYear')
      : draft.from === draft.to
        ? String(draft.from)
        : t('filterSheet.range', { from: draft.from, to: draft.to });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          // Evita que o toque num chip feche o modal pelo overlay por baixo.
          onPress={() => {}}>
          <View style={styles.header}>
            {onYearChange ? (
              <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
                {(['genre', 'year'] as const).map((value) => (
                  <Pressable
                    key={value}
                    style={[styles.tab, tab === value && { backgroundColor: theme.accent }]}
                    onPress={() => setTab(value)}>
                    <ThemedText
                      type="small"
                      style={{ color: tab === value ? theme.accentText : theme.text }}>
                      {value === 'genre' ? t('filterSheet.category') : t('filterSheet.year')}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <ThemedText type="subtitle">{t('filterSheet.category')}</ThemedText>
            )}
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          {tab === 'genre' || !onYearChange ? (
            <ScrollView contentContainerStyle={styles.chips}>
              <Pressable
                style={[
                  styles.chip,
                  { backgroundColor: selectedId === null ? theme.accent : theme.backgroundElement },
                ]}
                onPress={() => chooseGenre(null)}>
                <ThemedText
                  type="small"
                  style={{ color: selectedId === null ? theme.accentText : theme.text }}>
                  {t('filterSheet.all')}
                </ThemedText>
              </Pressable>
              {genres.map((genre) => (
                <Pressable
                  key={genre.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        selectedId === genre.id ? theme.accent : theme.backgroundElement,
                    },
                  ]}
                  onPress={() => chooseGenre(genre.id)}>
                  <ThemedText
                    type="small"
                    style={{ color: selectedId === genre.id ? theme.accentText : theme.text }}>
                    {genre.name}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.yearContent}>
              <ThemedText type="subtitle" style={styles.yearLabel}>
                {draftLabel}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.yearHint}>
                {t('filterSheet.yearHint')}
              </ThemedText>
              <YearRangeSlider
                min={MIN_YEAR}
                max={MAX_YEAR}
                from={draft.from}
                to={draft.to}
                onChange={(from, to) => setDraft({ from, to })}
              />
              <View style={styles.chips}>
                {presets.map((preset) => {
                  const selected =
                    draft.from === preset.range.from && draft.to === preset.range.to;
                  return (
                    <Pressable
                      key={preset.label}
                      style={[
                        styles.chip,
                        { backgroundColor: selected ? theme.accent : theme.backgroundElement },
                      ]}
                      onPress={() => setDraft(preset.range)}>
                      <ThemedText
                        type="small"
                        style={{ color: selected ? theme.accentText : theme.text }}>
                        {preset.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.action, { backgroundColor: theme.backgroundElement }]}
                  onPress={() => applyYears({ from: MIN_YEAR, to: MAX_YEAR })}>
                  <ThemedText type="smallBold">{t('filterSheet.clear')}</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.action, { backgroundColor: theme.accent }]}
                  onPress={() => applyYears(draft)}>
                  <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                    {t('filterSheet.apply')}
                  </ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Spacing.four,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 2,
  },
  tab: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  yearContent: {
    paddingBottom: Spacing.four,
  },
  yearLabel: {
    textAlign: 'center',
  },
  yearHint: {
    textAlign: 'center',
    marginTop: Spacing.half,
    marginBottom: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: Spacing.two + Spacing.half,
  },
});
