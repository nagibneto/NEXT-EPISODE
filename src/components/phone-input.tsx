import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIncompletePhoneNumber, type CountryCode } from 'libphonenumber-js';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCountryOptions, type CountryOption } from '@/lib/countries';

interface PhoneInputProps {
  countryCode: CountryCode;
  /** Só os dígitos, sem o código do país (ex.: "11987654321"). */
  nationalNumber: string;
  onChangeCountryCode: (code: CountryCode) => void;
  onChangeNationalNumber: (digits: string) => void;
  autoFocus?: boolean;
}

/**
 * Campo de telefone com seletor de país (bandeira + DDI) e formatação ao
 * digitar (ex.: "11" já vira "(11)" pro Brasil) — usa formatIncompletePhoneNumber
 * do libphonenumber-js, que já sabe o padrão de cada país.
 */
export function PhoneInput({
  countryCode,
  nationalNumber,
  onChangeCountryCode,
  onChangeNationalNumber,
  autoFocus,
}: PhoneInputProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const options = useMemo(() => getCountryOptions(i18n.language), [i18n.language]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (option) => option.name.toLowerCase().includes(term) || option.dialCode.includes(term)
    );
  }, [options, search]);
  const selected = options.find((option) => option.code === countryCode);

  function selectCountry(option: CountryOption) {
    onChangeCountryCode(option.code);
    setPickerOpen(false);
    setSearch('');
  }

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.countryButton, { backgroundColor: theme.background }]}
        onPress={() => setPickerOpen(true)}>
        <ThemedText style={styles.flag}>{selected?.flag ?? '🏳️'}</ThemedText>
        <ThemedText type="smallBold">+{selected?.dialCode}</ThemedText>
        <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
      </Pressable>
      <TextInput
        style={[styles.input, { backgroundColor: theme.background, color: theme.text }]}
        placeholder={t('findFriendsContacts.phonePlaceholder')}
        placeholderTextColor={theme.textSecondary}
        keyboardType="phone-pad"
        autoFocus={autoFocus}
        value={formatIncompletePhoneNumber(nationalNumber, countryCode)}
        onChangeText={(text) => onChangeNationalNumber(text.replace(/\D/g, ''))}
      />

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setPickerOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}
            // Impede que o toque dentro do cartão feche o modal.
            onPress={(event) => event.stopPropagation()}>
            <ThemedText type="subtitle" style={styles.sheetTitle}>
              {t('findFriendsContacts.chooseCountry')}
            </ThemedText>
            <View style={[styles.searchBox, { backgroundColor: theme.background }]}>
              <Ionicons name="search" size={16} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder={t('findFriendsContacts.searchCountry')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.countryRow,
                    item.code === countryCode && { backgroundColor: theme.backgroundSelected },
                  ]}
                  onPress={() => selectCountry(item)}>
                  <ThemedText style={styles.flag}>{item.flag}</ThemedText>
                  <ThemedText style={styles.countryName} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">+{item.dialCode}</ThemedText>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
  },
  flag: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: Spacing.four,
    gap: Spacing.three,
    maxHeight: '80%',
  },
  sheetTitle: {
    textAlign: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
  },
  list: {
    flexGrow: 0,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
  },
  countryName: {
    flex: 1,
  },
});
