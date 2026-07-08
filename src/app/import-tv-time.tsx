import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { followShowsBulk, importWatchedEpisodesBulk } from '@/lib/db';
import { posterUrl, searchShows, type TmdbShowSummary } from '@/lib/tmdb';
import {
  dedupeEpisodes,
  extractShowsCsvText,
  groupBySeries,
  matchSeriesToTmdb,
  parseTvTimeShowsCsv,
  type TvTimeSeriesGroup,
} from '@/lib/tvtime-import';

const GDPR_EXPORT_URL = 'https://gdpr.tvtime.com/gdpr/self-service';

type Step = 'intro' | 'matching' | 'review' | 'importing' | 'done';

interface ReviewItem {
  group: TvTimeSeriesGroup;
  candidates: TmdbShowSummary[];
  selected: TmdbShowSummary | null;
  included: boolean;
  searchOpen: boolean;
}

export default function ImportTvTimeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [result, setResult] = useState({ shows: 0, episodes: 0, skipped: 0 });

  async function handlePickFile() {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed', 'text/csv', '*/*'],
    });
    if (picked.canceled) return;

    try {
      const file = new File(picked.assets[0].uri);
      const bytes = await file.bytes();
      const csvText = extractShowsCsvText(bytes);
      const rows = parseTvTimeShowsCsv(csvText);
      if (rows.length === 0) {
        setError('Não encontramos nenhum episódio assistido nesse arquivo.');
        return;
      }
      const groups = groupBySeries(rows);
      setStep('matching');
      setProgress({ done: 0, total: groups.length });

      const matches = await matchSeriesToTmdb(
        groups.map((g) => g.seriesName),
        (done, total) => setProgress({ done, total })
      );

      setItems(
        groups.map((group) => {
          const candidates = matches.get(group.seriesName) ?? [];
          return {
            group,
            candidates,
            selected: candidates[0] ?? null,
            included: candidates.length > 0,
            searchOpen: false,
          };
        })
      );
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ler o arquivo.');
      setStep('intro');
    }
  }

  function updateItem(index: number, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleImport() {
    if (!user) return;
    const toImport = items.filter((item) => item.included && item.selected);

    // Mais de uma série do TV Time pode ter sido casada com o mesmo show do
    // TMDB (nomes diferentes, mesma série) — junta tudo por tmdb_id antes de
    // gravar, senão o upsert de followed_shows tenta inserir o mesmo id duas
    // vezes no mesmo comando e o Postgres rejeita.
    const byShowId = new Map<number, { show: TmdbShowSummary; episodes: typeof toImport[number]['group']['episodes'] }>();
    for (const item of toImport) {
      const show = item.selected!;
      const existing = byShowId.get(show.id);
      if (existing) {
        existing.episodes.push(...item.group.episodes);
      } else {
        byShowId.set(show.id, { show, episodes: [...item.group.episodes] });
      }
    }
    const merged = Array.from(byShowId.values()).map(({ show, episodes }) => ({
      show,
      episodes: dedupeEpisodes(episodes),
    }));

    setStep('importing');
    setProgress({ done: 0, total: merged.length });

    await followShowsBulk(
      user.id,
      merged.map(({ show }) => ({
        tmdb_id: show.id,
        name: show.name,
        poster_path: show.poster_path,
      }))
    );

    let episodeCount = 0;
    for (const [i, { show, episodes }] of merged.entries()) {
      await importWatchedEpisodesBulk(
        user.id,
        show.id,
        episodes.map((episode) => ({
          season_number: episode.seasonNumber,
          episode_number: episode.episodeNumber,
          watched_at: episode.watchedAt,
        }))
      );
      episodeCount += episodes.length;
      setProgress({ done: i + 1, total: merged.length });
    }

    setResult({
      shows: merged.length,
      episodes: episodeCount,
      skipped: items.length - toImport.length,
    });
    setStep('done');
  }

  if (step === 'intro') {
    return (
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
        <ThemedText type="subtitle">Importar do TV Time</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.paragraph}>
          O TV Time vai desligar em 15/07/2026 e não tem API pública. Pra trazer seu
          histórico pra cá, exporte seus dados oficialmente pelo site do TV Time e
          selecione o arquivo .zip aqui — não precisa extrair nada, a gente cuida disso.
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.paragraph}>
          1. Abra o exportador do TV Time e faça login com sua conta.{'\n'}
          2. Baixe o arquivo .zip que eles enviarem por e-mail.{'\n'}
          3. Volte aqui e selecione esse .zip.
        </ThemedText>

        <Pressable
          style={[styles.button, { backgroundColor: theme.backgroundElement }]}
          onPress={() => Linking.openURL(GDPR_EXPORT_URL)}>
          <ThemedText type="smallBold">Abrir exportador do TV Time</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.button, { backgroundColor: theme.accent }]}
          onPress={handlePickFile}>
          <ThemedText type="smallBold" style={{ color: theme.accentText }}>
            Selecionar arquivo .zip
          </ThemedText>
        </Pressable>

        {error ? (
          <ThemedText themeColor="danger" style={styles.paragraph}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>
    );
  }

  if (step === 'matching' || step === 'importing') {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary" style={styles.paragraph}>
          {step === 'matching'
            ? `Buscando suas séries no TMDB… ${progress.done}/${progress.total}`
            : `Importando séries… ${progress.done}/${progress.total}`}
        </ThemedText>
      </View>
    );
  }

  if (step === 'done') {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText type="subtitle">Importação concluída</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.paragraph}>
          {result.shows} séries seguidas, {result.episodes} episódios importados.
          {result.skipped > 0 ? ` ${result.skipped} séries ignoradas.` : ''}
        </ThemedText>
      </View>
    );
  }

  // step === 'review'
  return (
    <View style={[styles.container, { flex: 1, backgroundColor: theme.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.group.seriesName}
        contentContainerStyle={styles.reviewList}
        ListHeaderComponent={
          <ThemedText themeColor="textSecondary" style={styles.paragraph}>
            Revise as séries encontradas antes de importar. Desmarque as que não
            reconhecemos direito ou troque o resultado.
          </ThemedText>
        }
        renderItem={({ item, index }) => (
          <ReviewRow
            item={item}
            onToggle={() => updateItem(index, { included: !item.included })}
            onSelect={(show) => updateItem(index, { selected: show, included: true, searchOpen: false })}
            onOpenSearch={() => updateItem(index, { searchOpen: !item.searchOpen })}
          />
        )}
      />
      <Pressable
        style={[styles.button, styles.importButton, { backgroundColor: theme.accent }]}
        onPress={handleImport}>
        <ThemedText type="smallBold" style={{ color: theme.accentText }}>
          Importar {items.filter((i) => i.included && i.selected).length} séries
        </ThemedText>
      </Pressable>
    </View>
  );
}

function ReviewRow({
  item,
  onToggle,
  onSelect,
  onOpenSearch,
}: {
  item: ReviewItem;
  onToggle: () => void;
  onSelect: (show: TmdbShowSummary) => void;
  onOpenSearch: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [manualResults, setManualResults] = useState<TmdbShowSummary[]>([]);
  const uri = posterUrl(item.selected?.poster_path ?? null, 'w185');

  async function handleSearch(text: string) {
    setQuery(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setManualResults([]);
      return;
    }
    try {
      const { results } = await searchShows(trimmed);
      setManualResults(results);
    } catch {
      setManualResults([]);
    }
  }

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      <Pressable style={styles.rowMain} onPress={onToggle}>
        {uri ? (
          <Image source={{ uri }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.rowText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {item.selected ? item.selected.name : item.group.seriesName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {item.group.seriesName} · {item.group.episodes.length} episódios
          </ThemedText>
          {!item.selected ? (
            <ThemedText type="small" themeColor="danger">
              Não encontrado no TMDB
            </ThemedText>
          ) : null}
        </View>
        <View
          style={[
            styles.checkbox,
            { borderColor: theme.textSecondary },
            item.included && { backgroundColor: theme.accent, borderColor: theme.accent },
          ]}
        />
      </Pressable>

      <Pressable onPress={onOpenSearch} style={styles.changeButton}>
        <ThemedText type="link" themeColor="textSecondary">
          {item.searchOpen ? 'Fechar' : 'Trocar'}
        </ThemedText>
      </Pressable>

      {item.searchOpen ? (
        <View style={styles.searchBox}>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
            placeholder="Buscar outra série…"
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={handleSearch}
            autoCorrect={false}
          />
          {manualResults.map((show) => (
            <Pressable key={show.id} style={styles.manualResult} onPress={() => onSelect(show)}>
              <ThemedText type="small">
                {show.name} {show.first_air_date ? `(${show.first_air_date.slice(0, 4)})` : ''}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  paragraph: {
    lineHeight: 22,
  },
  button: {
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
  },
  importButton: {
    margin: Spacing.three,
  },
  reviewList: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    borderRadius: 12,
    padding: Spacing.two,
    marginBottom: Spacing.two,
    gap: Spacing.one,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  poster: {
    width: 46,
    height: 69,
    borderRadius: 6,
  },
  posterFallback: {},
  rowText: {
    flex: 1,
    gap: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  changeButton: {
    alignSelf: 'flex-end',
  },
  searchBox: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 14,
  },
  manualResult: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.two,
  },
});
