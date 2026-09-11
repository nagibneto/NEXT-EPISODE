import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

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
  /** Toque no botão do canto do pôster (seguir série / pôr filme em "para assistir"). Omitido = sem botão. */
  onQuickAdd?: () => void;
  /**
   * Estado do botão do canto:
   * - `none`: fora da lista, mostra "+".
   * - `listed`: série seguida (✓) ou filme em "para assistir" (marcador).
   * - `done`: filme já assistido — ✓ e sem ação.
   */
  quickAddState?: 'none' | 'listed' | 'done';
  /** Ação do botão em andamento: mostra spinner e ignora toques. */
  quickAddBusy?: boolean;
}

export function ShowCard({
  tmdbId,
  name,
  posterPath,
  subtitle,
  rating,
  media = 'tv',
  progress,
  onQuickAdd,
  quickAddState = 'none',
  quickAddBusy = false,
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
        {onQuickAdd ? (
          <Pressable
            style={[
              styles.quickAdd,
              {
                backgroundColor:
                  quickAddState === 'none' ? 'rgba(0,0,0,0.6)' : theme.accent,
              },
            ]}
            hitSlop={8}
            disabled={quickAddBusy || quickAddState === 'done'}
            onPress={onQuickAdd}>
            {quickAddBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name={
                  quickAddState === 'done'
                    ? 'checkmark'
                    : quickAddState === 'listed'
                      ? media === 'movie'
                        ? 'bookmark'
                        : 'checkmark'
                      : 'add'
                }
                size={20}
                color="#fff"
              />
            )}
          </Pressable>
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
  quickAdd: {
    position: 'absolute',
    // Compensa o padding do card para o botão colar no canto do pôster.
    top: Spacing.two + Spacing.one + 2,
    right: Spacing.two + Spacing.one + 2,
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
