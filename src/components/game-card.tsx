import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { GameStatus } from '@/lib/db';
import { igdbImage } from '@/lib/igdb';

/** Ícone de cada status da coleção — o mesmo na grade, na prateleira e no detalhe. */
export const GAME_STATUS_ICON: Record<GameStatus, keyof typeof Ionicons.glyphMap> = {
  want: 'bookmark',
  playing: 'game-controller',
  completed: 'trophy',
  played: 'checkmark-done-circle',
  dropped: 'close-circle',
};

interface GameCardProps {
  igdbId: number;
  name: string;
  coverId: string | null;
  /** Linha de baixo (ano, plataformas…). */
  subtitle?: string | null;
  /** Nota da IGDB já na escala 0–10; 0/ausente esconde a nota. */
  rating?: number;
  /** Status na coleção do usuário — vira um selo no canto da capa. */
  status?: GameStatus | null;
  /** Largura fixa (prateleira horizontal). Omitido = coluna de 1/3 da grade. */
  width?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Capa de jogo que abre a tela do game. As capas da IGDB são retrato (3:4),
 * um pouco mais largas que os pôsteres 2:3 da TMDB.
 */
export function GameCard({
  igdbId,
  name,
  coverId,
  subtitle,
  rating,
  status,
  width,
  style,
}: GameCardProps) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const uri = igdbImage(coverId, 'cover_big');
  const badgeInset = (width ? 0 : Spacing.two) + Spacing.one + 2;
  const ratingLabel =
    rating && rating > 0
      ? rating.toFixed(1).replace('.', i18n.language.startsWith('pt') ? ',' : '.')
      : null;

  return (
    <Link href={{ pathname: '/game/[id]', params: { id: String(igdbId) } }} asChild>
      {/* flatten é obrigatório: o Link asChild mescla o style com spread de
          objeto, e um array viraria {0: …, 1: …} — a largura se perdia e a
          capa ocupava a tela inteira. */}
      <Pressable style={StyleSheet.flatten([width ? { width } : styles.gridCard, style])}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.cover}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={String(igdbId)}
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="game-controller-outline" size={28} color={theme.textSecondary} />
            <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={3} style={styles.fallbackName}>
              {name}
            </ThemedText>
          </View>
        )}
        {status ? (
          <View
            style={[
              styles.statusBadge,
              // Na grade o card tem padding; o selo compensa para colar na capa.
              { backgroundColor: theme.accent, top: badgeInset, right: badgeInset },
            ]}>
            <Ionicons name={GAME_STATUS_ICON[status]} size={14} color={theme.accentText} />
          </View>
        ) : null}
        <ThemedText type="smallBold" numberOfLines={2} style={styles.name}>
          {name}
        </ThemedText>
        {subtitle || ratingLabel ? (
          <View style={styles.metaRow}>
            {subtitle ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.metaText}>
                {subtitle}
              </ThemedText>
            ) : null}
            {ratingLabel ? (
              <View style={styles.rating}>
                <Ionicons name="star" size={11} color={theme.gold} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.metaText}>
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
  // Mesmo esquema do ShowCard: padding dentro da coluna, teto de 1/3 para uma
  // linha com menos de 3 itens não esticar o card.
  gridCard: {
    flex: 1,
    maxWidth: '33.33%',
    padding: Spacing.two,
  },
  cover: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
  },
  fallbackName: {
    textAlign: 'center',
  },
  statusBadge: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: Spacing.one + 2,
    fontSize: 13,
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 1,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
