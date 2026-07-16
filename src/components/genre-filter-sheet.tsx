import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TmdbGenre } from '@/lib/tmdb';

interface GenreFilterSheetProps {
  visible: boolean;
  genres: TmdbGenre[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}

/** Bottom sheet para filtrar a watchlist por categoria/gênero da TMDB. */
export function GenreFilterSheet({
  visible,
  genres,
  selectedId,
  onSelect,
  onClose,
}: GenreFilterSheetProps) {
  const theme = useTheme();

  function choose(id: number | null) {
    onSelect(id);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          // Evita que o toque num chip feche o modal pelo overlay por baixo.
          onPress={() => {}}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Categoria</ThemedText>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.chips}>
            <Pressable
              style={[
                styles.chip,
                { backgroundColor: selectedId === null ? theme.accent : theme.backgroundElement },
              ]}
              onPress={() => choose(null)}>
              <ThemedText
                type="small"
                style={{ color: selectedId === null ? theme.accentText : theme.text }}>
                Todas
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
                onPress={() => choose(genre.id)}>
                <ThemedText
                  type="small"
                  style={{ color: selectedId === genre.id ? theme.accentText : theme.text }}>
                  {genre.name}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
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
});
