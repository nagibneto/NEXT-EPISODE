import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { PosterShelf } from '@/components/poster-shelf';
import { StatusTabs } from '@/components/status-tabs';
import { StreamingPickerSheet } from '@/components/streaming-picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useQuickAdd } from '@/hooks/use-quick-add';
import { useTheme } from '@/hooks/use-theme';
import { getStreamingServices } from '@/lib/db';
import {
  becauseShelf,
  catalogShelf,
  emptyTaste,
  forYouShelf,
  librarySignature,
  loadTaste,
  minVotesFor,
  monthsAgo,
  type DiscoverItem,
  type DiscoverMedia,
  type ShelfFilter,
  type Taste,
} from '@/lib/discover';
import {
  clearListCache,
  getAllStreamingProviders,
  getGenres,
  LIST_CACHE_TTL_MS,
  providerLogoUrl,
  type TmdbGenre,
  type TmdbWatchProvider,
} from '@/lib/tmdb';

/** Mesmo desenho do ícone da aba (ver scripts/draw-popcorn-icon.py). */
const POPCORN_ICON = require('../../../assets/images/tabIcons/popcorn.png');

/** Logos mostrados no cartão "Seus streamings" antes do "+N". */
const LOGOS_SHOWN = 5;

/**
 * Documentário e música (shows, especiais de turnê) dominam as notas altas
 * com poucos votos e não são o que se espera de "pérola escondida". Os ids
 * são os mesmos nas listas de filme e de série.
 */
const GEMS_EXCLUDED_GENRES = [99, 10402];

/** Máximo de prateleiras "Em alta em <streaming>", para a tela não virar só isso. */
const PROVIDER_SHELVES = 4;

interface ShelfDef {
  key: string;
  title: string;
  showReason?: boolean;
  load: () => Promise<DiscoverItem[]>;
}

/** Chip de categoria (Para você / gêneros) no topo da tela. */
function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  /** Ícone monocromático, pintado com a cor do texto (pipoca do chip "Para você"). */
  icon?: ImageSource;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.accent : theme.backgroundElement,
          borderColor: active ? theme.accent : theme.backgroundSelected,
        },
      ]}
      onPress={onPress}>
      {icon ? (
        <Image
          source={icon}
          style={styles.chipIcon}
          tintColor={active ? theme.accentText : theme.text}
        />
      ) : null}
      <ThemedText type="small" style={{ color: active ? theme.accentText : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function DiscoverScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const quickAdd = useQuickAdd();
  const [mode, setMode] = useState<DiscoverMedia>('movie');
  // Gêneros e gosto ficam guardados junto com o modo/carga a que pertencem:
  // logo após trocar Filmes/Séries ainda há um render com os dados do modo
  // anterior, e montar prateleiras nele gravava filmes no cache das séries.
  const [loadedGenres, setLoadedGenres] = useState<{
    media: DiscoverMedia;
    list: TmdbGenre[];
  } | null>(null);
  const [genreId, setGenreId] = useState<number | null>(null);
  // null = ainda carregando; [] = usuário não escolheu nenhum.
  const [myProviderIds, setMyProviderIds] = useState<number[] | null>(null);
  const [allProviders, setAllProviders] = useState<TmdbWatchProvider[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadedTaste, setLoadedTaste] = useState<{
    /** Usuário/modo/idioma a que o gosto pertence. */
    base: string;
    /** Carga específica (inclui atualizações); vira a chave das prateleiras. */
    key: string;
    taste: Taste;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Sobe quando a coleção do usuário muda (ver checkForUpdates).
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Resultado de cada prateleira, para alternar Filmes/Séries ou gêneros e
  // voltar sem refazer as requisições. Limpo no "puxar para atualizar".
  const shelfCache = useRef(new Map<string, Promise<DiscoverItem[]>>());
  const loadedAt = useRef(0);
  const focused = useRef(false);

  // Recarrega ao focar: os streamings podem ter mudado pelo Perfil.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      getStreamingServices(user.id)
        .then((ids) => {
          if (cancelled) return;
          // Mesmo conteúdo = mesmo array, para não recriar as prateleiras.
          setMyProviderIds((prev) =>
            prev && prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids
          );
        })
        .catch(() => {
          if (!cancelled) setMyProviderIds((prev) => prev ?? []);
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  useEffect(() => {
    getAllStreamingProviders()
      .then(setAllProviders)
      .catch(() => setAllProviders([]));
  }, []);

  // Os ids de gênero de filme e de série são diferentes.
  useEffect(() => {
    let cancelled = false;
    getGenres(mode)
      .catch(() => [] as TmdbGenre[])
      .then((list) => {
        if (!cancelled) setLoadedGenres({ media: mode, list });
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const genres = loadedGenres?.media === mode ? loadedGenres.list : null;

  const tasteBase = [user?.id, mode, i18n.language].join('|');
  const tasteKey = [tasteBase, refreshKey, libraryVersion].join('|');
  // Com o mesmo usuário/modo/idioma, o gosto anterior continua na tela até o
  // novo ficar pronto: recalcular depois de o usuário assistir algo não pode
  // trocar a tela inteira por um spinner.
  const taste = loadedTaste?.base === tasteBase ? loadedTaste.taste : null;
  const shownTasteKey = loadedTaste?.key ?? '';

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadTaste(user.id, mode, i18n.language)
      .catch(() => emptyTaste(mode))
      .then((result) => {
        if (cancelled) return;
        loadedAt.current = Date.now();
        setLoadedTaste({ base: tasteBase, key: tasteKey, taste: result });
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // tasteKey já resume user/mode/idioma/refreshKey/libraryVersion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteKey]);

  function selectMode(value: DiscoverMedia) {
    if (value === mode) return;
    // Junto com a troca (mesmo render): o gênero escolhido é de outro modo.
    setGenreId(null);
    setMode(value);
  }

  function handleRefresh() {
    setRefreshing(true);
    shelfCache.current.clear();
    // Puxar para atualizar busca tudo de novo no TMDB, sem esperar a validade.
    clearListCache();
    setRefreshKey((key) => key + 1);
  }

  /**
   * Ao voltar para a aba (ou trazer o app do segundo plano): passou da
   * validade das listas, recarrega tudo; senão, se a coleção mudou desde o
   * cálculo do gosto (assistiu, seguiu, favoritou…), recalcula o gosto. As
   * listas do TMDB seguem em cache, então só o que depende do gosto muda.
   */
  async function checkForUpdates() {
    if (!user || !taste) return;
    if (Date.now() - loadedAt.current > LIST_CACHE_TTL_MS) {
      shelfCache.current.clear();
      setRefreshKey((key) => key + 1);
      return;
    }
    const signature = await librarySignature(user.id, mode, i18n.language).catch(() => null);
    if (signature !== null && signature !== taste.signature) {
      setLibraryVersion((version) => version + 1);
    }
  }
  // Os listeners abaixo são registrados uma vez; a ref aponta sempre para a
  // versão com o estado atual.
  const checkForUpdatesRef = useRef(checkForUpdates);
  checkForUpdatesRef.current = checkForUpdates;

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      checkForUpdatesRef.current();
      return () => {
        focused.current = false;
      };
    }, [])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) checkForUpdatesRef.current();
    });
    return () => subscription.remove();
  }, []);

  const providerIds = useMemo(
    () => (onlyMine && myProviderIds ? myProviderIds : []),
    [onlyMine, myProviderIds]
  );

  const shelves = useMemo<ShelfDef[]>(() => {
    if (!taste || !genres || myProviderIds === null) return [];
    const filter: ShelfFilter = { genreId, providerIds };
    const baseKey = [shownTasteKey, genreId, providerIds.join(',')].join('|');
    const genreName = (id: number) => genres.find((genre) => genre.id === id)?.name;
    const list: ShelfDef[] = [];
    const add = (
      key: string,
      title: string,
      load: () => Promise<DiscoverItem[]>,
      showReason = false
    ) => {
      const cacheKey = `${key}|${baseKey}`;
      list.push({
        key: cacheKey,
        title,
        showReason,
        load: () => {
          let cached = shelfCache.current.get(cacheKey);
          if (!cached) {
            cached = load().catch((error) => {
              shelfCache.current.delete(cacheKey);
              throw error;
            });
            shelfCache.current.set(cacheKey, cached);
          }
          return cached;
        },
      });
    };

    const selectedGenre = genreId ? genreName(genreId) : null;
    const hasProviders = providerIds.length > 0;
    // Sem chip de gênero, a tela é montada em torno do gosto do usuário;
    // com chip, vira um catálogo daquele gênero.
    const [recent1, recent2] = taste.recent.filter((seed, index, all) =>
      all.findIndex((other) => other.id === seed.id) === index
    );
    const [genre1, genre2] = taste.topGenreIds.filter((id) => genreName(id));

    add(
      'forYou',
      selectedGenre
        ? t('discover.shelf.forYouGenre', { genre: selectedGenre })
        : t('discover.shelf.forYou'),
      () => forYouShelf(taste, filter),
      true
    );
    if (!genreId && recent1) {
      add(`because-${recent1.id}`, t('discover.shelf.because', { title: recent1.title }), () =>
        becauseShelf(taste, filter, recent1)
      );
    }
    add(
      'trending',
      hasProviders ? t('discover.shelf.trendingMine') : t('discover.shelf.trending'),
      () => catalogShelf(taste, filter, { minVotes: minVotesFor(mode, 100) })
    );
    if (!genreId && genre1) {
      add(`genre-${genre1}`, t('discover.shelf.genre', { genre: genreName(genre1) }), () =>
        catalogShelf(
          taste,
          { ...filter, genreId: genre1 },
          { minVotes: minVotesFor(mode, 200), minRating: 6.5 }
        )
      );
    }
    if (!genreId && recent2) {
      add(`because-${recent2.id}`, t('discover.shelf.because', { title: recent2.title }), () =>
        becauseShelf(taste, filter, recent2)
      );
    }
    // Uma prateleira por streaming só faz sentido quando há mais de um: com
    // um só, ela repetiria o "Em alta nos seus streamings".
    if (hasProviders && providerIds.length > 1) {
      for (const providerId of providerIds.slice(0, PROVIDER_SHELVES)) {
        const provider = allProviders.find((p) => p.provider_id === providerId);
        if (!provider) continue;
        add(
          `provider-${providerId}`,
          t('discover.shelf.onProvider', { provider: provider.provider_name }),
          () =>
            catalogShelf(
              taste,
              { ...filter, providerIds: [providerId] },
              { minVotes: minVotesFor(mode, 100) }
            )
        );
      }
    }
    if (!genreId && genre2) {
      add(`genre-${genre2}`, t('discover.shelf.genre', { genre: genreName(genre2) }), () =>
        catalogShelf(
          taste,
          { ...filter, genreId: genre2 },
          { minVotes: minVotesFor(mode, 200), minRating: 6.5 }
        )
      );
    }
    add('topRated', t('discover.shelf.topRated'), () =>
      catalogShelf(taste, filter, { sortBy: 'rating', minVotes: minVotesFor(mode, 1000) })
    );
    add('newest', t('discover.shelf.newest'), () =>
      catalogShelf(taste, filter, {
        sortBy: 'newest',
        // Nos streamings o catálogo já é curado; sem filtro, o corte de votos
        // evita a enxurrada de lançamentos obscuros do mundo todo.
        minVotes: minVotesFor(mode, hasProviders ? 10 : 50),
        releasedAfter: monthsAgo(18),
      })
    );
    add('gems', t('discover.shelf.hiddenGems'), () =>
      catalogShelf(taste, filter, {
        sortBy: 'rating',
        minRating: 7.2,
        minVotes: minVotesFor(mode, 150),
        maxVotes: minVotesFor(mode, 1500),
        withoutGenreIds: GEMS_EXCLUDED_GENRES,
      })
    );
    return list;
  }, [taste, shownTasteKey, genres, myProviderIds, genreId, providerIds, mode, allProviders, t]);

  const myProviders = (myProviderIds ?? [])
    .map((id) => allProviders.find((provider) => provider.provider_id === id))
    .filter((provider): provider is TmdbWatchProvider => !!provider);
  const ready = taste !== null && genres !== null && myProviderIds !== null;

  const header = (
    <View>
      <StatusTabs
        options={[
          { value: 'movie', label: t('discover.movies') },
          { value: 'tv', label: t('discover.shows') },
        ] as const}
        value={mode}
        onChange={selectMode}
        style={styles.modeTabs}
      />

      {myProviderIds !== null && myProviderIds.length === 0 ? (
        <Pressable
          style={[styles.card, { backgroundColor: theme.backgroundElement }]}
          onPress={() => setPickerOpen(true)}>
          <View style={styles.setupRow}>
            <Ionicons name="play-circle" size={28} color={theme.accent} />
            <View style={styles.setupText}>
              <ThemedText type="smallBold">{t('discover.setupTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('discover.setupText')}
              </ThemedText>
            </View>
          </View>
          <View style={[styles.setupButton, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>
              {t('discover.setupButton')}
            </ThemedText>
          </View>
        </Pressable>
      ) : myProviderIds !== null ? (
        <View style={[styles.card, styles.servicesCard, { backgroundColor: theme.backgroundElement }]}>
          <Pressable
            style={styles.logos}
            hitSlop={8}
            accessibilityLabel={t('discover.edit')}
            onPress={() => setPickerOpen(true)}>
            {myProviders.slice(0, LOGOS_SHOWN).map((provider, index) => {
              const logo = providerLogoUrl(provider.logo_path);
              return logo ? (
                <Image
                  key={provider.provider_id}
                  source={{ uri: logo }}
                  style={[
                    styles.serviceLogo,
                    { marginLeft: index === 0 ? 0 : -8, borderColor: theme.backgroundElement },
                  ]}
                  cachePolicy="memory-disk"
                />
              ) : null;
            })}
            {myProviders.length > LOGOS_SHOWN ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.moreLogos}>
                +{myProviders.length - LOGOS_SHOWN}
              </ThemedText>
            ) : null}
            <Ionicons name="pencil" size={14} color={theme.accent} style={styles.editIcon} />
          </Pressable>
          <View style={styles.onlyMine}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {t('discover.onlyMine')}
            </ThemedText>
            <Switch
              value={onlyMine}
              onValueChange={setOnlyMine}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            />
          </View>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}>
        <Chip
          label={t('discover.forYouChip')}
          icon={POPCORN_ICON}
          active={genreId === null}
          onPress={() => setGenreId(null)}
        />
        {(genres ?? []).map((genre) => (
          <Chip
            key={genre.id}
            label={genre.name}
            active={genreId === genre.id}
            onPress={() => setGenreId(genre.id)}
          />
        ))}
      </ScrollView>

      {taste && taste.seeds.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {mode === 'movie' ? t('discover.coldStartMovies') : t('discover.coldStartShows')}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={shelves}
        keyExtractor={(shelf) => shelf.key}
        ListHeaderComponent={header}
        // Prateleiras fora da tela só carregam quando o usuário chega perto.
        initialNumToRender={3}
        windowSize={5}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={styles.list}
        ListEmptyComponent={ready ? null : <ActivityIndicator style={styles.loading} />}
        ListFooterComponent={
          ready && providerIds.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>
              {t('discover.justWatch')}
            </ThemedText>
          ) : null
        }
        renderItem={({ item: shelf }) => (
          <PosterShelf
            title={shelf.title}
            media={mode}
            load={shelf.load}
            showReason={shelf.showReason}
            quickAdd={quickAdd.enabled ? quickAdd : undefined}
          />
        )}
      />
      <StreamingPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSaved={(ids) => {
          setMyProviderIds(ids);
          // Quem acabou de escolher quer ver o filtro funcionando.
          if (ids.length > 0) setOnlyMine(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingBottom: Spacing.four,
  },
  modeTabs: {
    marginTop: Spacing.three,
  },
  card: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    borderRadius: Radius.xl,
    padding: Spacing.three,
  },
  setupRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'flex-start',
  },
  setupText: {
    flex: 1,
    gap: 2,
  },
  setupButton: {
    marginTop: Spacing.three,
    borderRadius: Radius.lg,
    paddingVertical: 10,
    alignItems: 'center',
  },
  servicesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
  },
  logos: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceLogo: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    borderWidth: 2,
  },
  moreLogos: {
    marginLeft: Spacing.one,
  },
  editIcon: {
    marginLeft: Spacing.two,
  },
  onlyMine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  chips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  chipIcon: {
    width: 16,
    height: 16,
  },
  hint: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  loading: {
    marginTop: Spacing.five,
  },
  attribution: {
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
});
