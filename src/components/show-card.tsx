import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { posterUrl } from '@/lib/tmdb';

interface ShowCardProps {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  subtitle?: string;
  /** Nota do TMDB (0–10) exibida ao lado do subtítulo; 0/ausente esconde a nota. */
  rating?: number;
  /** Para onde o card leva: série (padrão) ou filme. */
  media?: 'tv' | 'movie';
  /** Andamento na série (0–1, episódios assistidos ÷ exibidos); omitido = sem barra. */
  progress?: number;
}

export function ShowCard({
  tmdbId,
  name,
  posterPath,
  subtitle,
  rating,
  media = 'tv',
  progress,
}: ShowCardProps) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const uri = posterUrl(posterPath);
  // Sem títulos votados o TMDB devolve 0 — nesse caso não mostra nota nenhuma.
  const ratingLabel =
    rating && rating > 0
      ? rating.toFixed(1).replace('.', i18n.language.startsWith('pt') ? ',' : '.')
      : null;

  return (
    <Link
      href={
        media === 'movie'
          ? { pathname: '/movie/[id]', params: { id: String(tmdbId) } }
          : { pathname: '/show/[id]', params: { id: String(tmdbId) } }
      }
      asChild>
      <Pressable style={styles.card}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.poster}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(tmdbId)}
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={3}>
              {name}
            </ThemedText>
          </View>
        )}
        {progress !== undefined && (
          <View style={[styles.progressTrack, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {name}
        </ThemedText>
        {subtitle || ratingLabel ? (
          <View style={styles.metaRow}>
            {subtitle ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                style={styles.metaText}>
                {subtitle}
              </ThemedText>
            ) : null}
            {ratingLabel ? (
              <View style={styles.rating}>
                <Ionicons name="star" size={11} color={theme.gold} />
                <ThemedText type="small" themeColor="textSecondary">
                  {ratingLabel}
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    // Sem o teto, uma linha com menos de 3 itens (ex.: busca com um resultado
    // só) estica o card na largura toda. O respiro entre cards vem do padding
    // (que conta dentro do percentual), não de margin (que estouraria a linha).
    maxWidth: '33.33%',
    padding: Spacing.two,
  },
  poster: {
    aspectRatio: 2 / 3,
    borderRadius: 12,
    width: '100%',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.two,
  },
  name: {
    marginTop: Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Respiro entre o ano e a nota: com menos que isso a estrela cola no ano.
    gap: Spacing.two,
  },
  metaText: {
    // Encolhe antes da nota: com nome de ator longo, o ano/elenco corta e a
    // nota continua visível.
    flexShrink: 1,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
