import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { getFollowedShows, getWatchedMovies } from '@/lib/db';
import { getRecommendations, type Recommendation } from '@/lib/recommendations';
import { posterUrl } from '@/lib/tmdb';

interface RecommendationsProps {
  media: 'tv' | 'movie';
  tmdbId: number;
  /** Gêneros do título, vindos do detalhe já carregado pela tela. */
  genres: { id: number; name: string }[];
  /** Só busca quando o usuário terminou a série / assistiu o filme. */
  enabled: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Carrossel "Você também pode gostar", exibido só depois que o usuário termina
 * o título. Não renderiza nada enquanto carrega nem quando não há indicação —
 * é um extra, não pode quebrar a tela.
 */
export function Recommendations({ media, tmdbId, genres, enabled, style }: RecommendationsProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<Recommendation[] | null>(null);

  useEffect(() => {
    if (!enabled) {
      setItems(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // O que o usuário já segue/assistiu sai da lista; se a consulta falhar,
      // no pior caso indicamos algo repetido.
      const seen = user
        ? await (media === 'tv'
            ? getFollowedShows(user.id).then((shows) => shows.map((show) => show.tmdb_id))
            : getWatchedMovies(user.id).then((movies) => movies.map((movie) => movie.tmdb_id))
          ).catch(() => [] as number[])
        : [];
      if (cancelled) return;
      const result = await getRecommendations({
        media,
        tmdbId,
        genres,
        excludeIds: new Set(seen),
      }).catch(() => [] as Recommendation[]);
      if (!cancelled) setItems(result);
    })();
    return () => {
      cancelled = true;
    };
    // `genres` vem de um objeto novo a cada render da tela; a identidade do
    // título já define o conteúdo, então basta ele nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, media, tmdbId, user]);

  if (!items || items.length === 0) return null;

  return (
    <View style={[styles.container, style]}>
      <ThemedText type="smallBold" style={styles.title}>
        {t('recommendations.title')}
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const poster = posterUrl(item.posterPath, 'w342');
          return (
            <Link
              key={item.id}
              href={
                media === 'movie'
                  ? { pathname: '/movie/[id]', params: { id: String(item.id) } }
                  : { pathname: '/show/[id]', params: { id: String(item.id) } }
              }
              // Troca a tela em vez de empilhar: pulando de indicação em
              // indicação a pilha crescia sem fim e o Voltar percorria um a um
              // todos os títulos visitados, sem nunca chegar à tela de origem.
              replace
              asChild>
              <Pressable style={styles.card}>
                {poster ? (
                  <Image
                    source={{ uri: poster }}
                    style={styles.poster}
                    contentFit="cover"
                    transition={150}
                    cachePolicy="memory-disk"
                    recyclingKey={String(item.id)}
                  />
                ) : (
                  <View
                    style={[styles.poster, styles.posterFallback, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                      {item.title}
                    </ThemedText>
                  </View>
                )}
                <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                  {item.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.meta}>
                  {[item.year, item.voteAverage > 0 ? `⭐ ${item.voteAverage.toFixed(1)}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={[styles.reason, { color: theme.accent }]}>
                  {t(`recommendations.reason.${item.reason.key}`, { value: item.reason.value })}
                </ThemedText>
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  title: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    fontSize: 18,
  },
  row: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    width: 110,
  },
  poster: {
    width: 110,
    aspectRatio: 2 / 3,
    borderRadius: 12,
    marginBottom: Spacing.one,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.two,
  },
  name: {
    fontSize: 13,
    lineHeight: 17,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
  },
  reason: {
    fontSize: 11,
    lineHeight: 15,
  },
});
