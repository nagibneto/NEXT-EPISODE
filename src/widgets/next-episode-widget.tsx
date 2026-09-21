"use no memo";

// O React Compiler (ligado em app.json) transforma componentes em funções
// memoizadas, e o react-native-android-widget precisa das funções cruas para
// percorrer a árvore JSX — com a transformação, o widget morre em "Invalid
// Hook Call". A diretiva desliga o compiler só neste arquivo.

/**
 * Desenho do widget do Android.
 *
 * Não é React de verdade: a biblioteca serializa esta árvore para RemoteViews,
 * então aqui não existem hooks, estado nem efeitos — tudo entra por props. O
 * conteúdo é o mesmo do widget do iOS (targets/widgets), com uma vantagem: a
 * lista rola de verdade, via ListWidget.
 */

import {
  FlexWidget,
  ImageWidget,
  ListWidget,
  TextWidget,
  type ImageWidgetSource,
} from 'react-native-android-widget';

import type { WidgetEpisode, WidgetPayload, WidgetQuiz } from '@/lib/widget-data';
import type { WidgetSection } from '@/widgets/storage';

type Hex = `#${string}`;

export interface WidgetPalette {
  background: Hex;
  card: Hex;
  text: Hex;
  textSecondary: Hex;
  accent: Hex;
  accentText: Hex;
  gold: Hex;
  danger: Hex;
}

/** Mesmos valores de src/constants/theme.ts. */
export const PALETTES: Record<'light' | 'dark', WidgetPalette> = {
  light: {
    background: '#FFFFFF',
    card: '#F0F0F3',
    text: '#000000',
    textSecondary: '#60646C',
    accent: '#2E7CF0',
    accentText: '#FFFFFF',
    gold: '#8A5A00',
    danger: '#D93025',
  },
  dark: {
    background: '#000000',
    card: '#212225',
    text: '#FFFFFF',
    textSecondary: '#B0B4BA',
    accent: '#5C9EFF',
    accentText: '#081326',
    gold: '#F5C518',
    danger: '#F28B82',
  },
};

/** Abaixo desta largura (dp) só cabe um item: é o "tamanho pequeno". */
export const COMPACT_WIDTH_DP = 200;

/** Ações que voltam para o task handler (as OPEN_* o Android resolve sozinho). */
export const CLICK_CHANGE_SECTION = 'CHANGE_SECTION';
export const CLICK_MARK_WATCHED = 'MARK_WATCHED';

const DEEP_LINK = 'nextepisode://';

function episodeUri(episode: WidgetEpisode) {
  return `${DEEP_LINK}/episode/${episode.showId}/${episode.seasonNumber}/${episode.episodeNumber}`;
}

/**
 * A tipagem do ImageWidget lista só http/https/data, mas o lado nativo também
 * trata "file://" (BitmapFactory.decodeFile) — e é justamente o caminho local
 * que evita o download a cada redesenho. Daí o cast.
 */
function posterSource(url: string | null): ImageWidgetSource | null {
  if (!url) return null;
  const supported = url.startsWith('https:') || url.startsWith('file:');
  return supported ? (url as ImageWidgetSource) : null;
}

function text(payload: WidgetPayload, key: string, fallback: string, count?: number): string {
  const value = payload.strings[key];
  const resolved = value && value.length > 0 ? value : fallback;
  return count === undefined ? resolved : resolved.replace('{n}', String(count));
}

export interface WidgetViewProps {
  payload: WidgetPayload | null;
  section: WidgetSection;
  consumedIds: string[];
  palette: WidgetPalette;
  /** Largura do widget em dp, para escolher entre o layout pequeno e o médio. */
  width: number;
}

export function NextEpisodeWidget(props: WidgetViewProps) {
  const { palette, width } = props;
  const compact = width < COMPACT_WIDTH_DP;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: palette.background,
        borderRadius: 20,
        padding: compact ? 10 : 12,
      }}>
      <Header {...props} compact={compact} />
      <Body {...props} compact={compact} />
    </FlexWidget>
  );
}

// ---------- Cabeçalho ----------

function sectionTitle(props: WidgetViewProps, compact: boolean): string {
  const payload = props.payload;
  if (!payload) return 'Next Episode';
  switch (props.section) {
    case 'watchNext':
      return compact
        ? text(payload, 'watchNextShort', 'A seguir')
        : text(payload, 'watchNextTitle', 'Assistir a seguir');
    case 'upcoming':
      return compact
        ? text(payload, 'upcomingShort', 'Próximos')
        : text(payload, 'upcomingTitle', 'Próximos episódios');
    case 'quiz':
      return compact ? text(payload, 'quizShort', 'Quiz') : text(payload, 'quizTitle', 'Quiz do dia');
  }
}

/**
 * Seta de trocar seção. Fica no topo do módulo de propósito: a biblioteca
 * percorre a árvore chamando cada função componente, e componentes declarados
 * dentro de outros são justamente o que o React Compiler mais transforma.
 */
function Arrow({
  glyph,
  delta,
  palette,
  size,
  fontSize,
}: {
  glyph: string;
  delta: number;
  palette: WidgetPalette;
  size: number;
  fontSize: number;
}) {
  return (
    <FlexWidget
      clickAction={CLICK_CHANGE_SECTION}
      clickActionData={{ delta }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.card,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
      }}>
      <TextWidget
        text={glyph}
        style={{ fontSize, fontWeight: 'bold', color: palette.accent }}
      />
    </FlexWidget>
  );
}

function Header(props: WidgetViewProps & { compact: boolean }) {
  const { palette, compact } = props;
  const size = compact ? 22 : 26;
  const fontSize = compact ? 14 : 16;

  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={sectionTitle(props, compact).toUpperCase()}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, fontWeight: 'bold', color: palette.textSecondary }}
        />
      </FlexWidget>
      <Arrow glyph="‹" delta={-1} palette={palette} size={size} fontSize={fontSize} />
      <Arrow glyph="›" delta={1} palette={palette} size={size} fontSize={fontSize} />
    </FlexWidget>
  );
}

// ---------- Conteúdo ----------

function Body(props: WidgetViewProps & { compact: boolean }) {
  const { payload, section, compact, palette } = props;

  if (!payload) {
    return (
      <Message
        palette={palette}
        title="Sem dados ainda"
        subtitle="Abra o Next Episode"
        uri={DEEP_LINK}
      />
    );
  }

  if (section === 'quiz') return <Quiz {...props} />;

  const episodes = section === 'watchNext' ? payload.watchNext : payload.upcoming;

  if (episodes.length === 0) {
    return (
      <Message
        palette={palette}
        title={
          section === 'watchNext'
            ? text(payload, 'noWatchNext', 'Você está em dia 🎉')
            : text(payload, 'noUpcoming', 'Nenhuma estreia marcada')
        }
        subtitle={null}
        uri={DEEP_LINK}
      />
    );
  }

  if (compact) return <CompactEpisode {...props} episode={episodes[0]} />;

  // ListWidget é a vantagem do Android: rola de verdade, sem paginação.
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent' }}>
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {episodes.map((episode) => (
          <Row key={episode.showId + '-' + episode.seasonNumber + '-' + episode.episodeNumber} {...props} episode={episode} />
        ))}
      </ListWidget>
    </FlexWidget>
  );
}

function Message({
  palette,
  title,
  subtitle,
  uri,
}: {
  palette: WidgetPalette;
  title: string;
  subtitle: string | null;
  uri: string;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{ flex: 1, width: 'match_parent', justifyContent: 'center' }}>
      <TextWidget
        text={title}
        maxLines={3}
        style={{ fontSize: 13, fontWeight: 'bold', color: palette.text }}
      />
      {subtitle ? (
        <TextWidget
          text={subtitle}
          maxLines={2}
          style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}
        />
      ) : (
        <FlexWidget style={{ width: 0, height: 0 }} />
      )}
    </FlexWidget>
  );
}

/** "S01E14" — o mesmo formato do feed e da tela de episódio. */
function code(episode: WidgetEpisode) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)}`;
}

function Row(props: WidgetViewProps & { episode: WidgetEpisode }) {
  const { episode, palette, payload, section, consumedIds } = props;
  const consumed = consumedIds.includes(
    `${episode.showId}-${episode.seasonNumber}-${episode.episodeNumber}`
  );
  const poster = posterSource(episode.posterUrl);
  const countdown = payload ? countdownLabel(episode, payload) : null;

  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: episodeUri(episode) }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
        {poster ? (
          <ImageWidget image={poster} imageWidth={22} imageHeight={33} radius={4} resizeMode="cover" />
        ) : (
          <FlexWidget style={{ width: 22, height: 33, borderRadius: 4, backgroundColor: palette.card }} />
        )}
        <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 8 }}>
          <TextWidget
            text={episode.showName}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 12, fontWeight: 'bold', color: palette.text }}
          />
          <TextWidget
            text={[code(episode), episode.episodeName].filter(Boolean).join(' · ')}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 10, color: palette.textSecondary }}
          />
        </FlexWidget>
      </FlexWidget>
      {section === 'watchNext' ? (
        <MarkButton episode={episode} palette={palette} consumed={consumed} />
      ) : (
        <TextWidget
          text={countdown ?? ''}
          maxLines={1}
          style={{ fontSize: 11, fontWeight: 'bold', color: palette.accent, marginLeft: 6 }}
        />
      )}
    </FlexWidget>
  );
}

/**
 * Anel vazio antes do toque, círculo cheio depois — igual ao iOS e à
 * watchlist do app. Um check colorido de saída pareceria dizer que o episódio
 * já foi visto, que é o contrário da ação.
 */
function MarkButton({
  episode,
  palette,
  consumed,
}: {
  episode: WidgetEpisode;
  palette: WidgetPalette;
  consumed: boolean;
}) {
  if (consumed) {
    return (
      <FlexWidget
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: palette.accent,
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 6,
        }}>
        <TextWidget text="✓" style={{ fontSize: 13, fontWeight: 'bold', color: palette.accentText }} />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      clickAction={CLICK_MARK_WATCHED}
      clickActionData={{
        showId: episode.showId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      }}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: palette.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
      }}>
      <TextWidget text="✓" style={{ fontSize: 13, color: palette.textSecondary }} />
    </FlexWidget>
  );
}

function CompactEpisode(props: WidgetViewProps & { episode: WidgetEpisode }) {
  const { episode, palette, payload, section, consumedIds } = props;
  const consumed = consumedIds.includes(
    `${episode.showId}-${episode.seasonNumber}-${episode.episodeNumber}`
  );
  const poster = posterSource(episode.posterUrl);
  const countdown = payload ? countdownLabel(episode, payload) : null;

  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: episodeUri(episode) }}
        style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
        {poster ? (
          <ImageWidget image={poster} imageWidth={28} imageHeight={42} radius={4} resizeMode="cover" />
        ) : (
          <FlexWidget style={{ width: 28, height: 42, borderRadius: 4, backgroundColor: palette.card }} />
        )}
        <TextWidget
          text={episode.showName}
          maxLines={2}
          truncate="END"
          style={{ fontSize: 13, fontWeight: 'bold', color: palette.text, marginTop: 4 }}
        />
        <TextWidget
          text={[code(episode), episode.episodeName].filter(Boolean).join(' · ')}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, color: palette.textSecondary }}
        />
      </FlexWidget>
      {section === 'watchNext' && payload ? (
        <CompactMarkButton
          episode={episode}
          palette={palette}
          consumed={consumed}
          label={
            consumed
              ? text(payload, 'markedWatched', 'Marcado!')
              : text(payload, 'markWatched', 'Marcar assistido')
          }
        />
      ) : (
        <TextWidget
          text={countdown ?? ''}
          maxLines={1}
          style={{ fontSize: 15, fontWeight: 'bold', color: palette.accent, marginTop: 4 }}
        />
      )}
    </FlexWidget>
  );
}

function CompactMarkButton({
  episode,
  palette,
  consumed,
  label,
}: {
  episode: WidgetEpisode;
  palette: WidgetPalette;
  consumed: boolean;
  label: string;
}) {
  if (consumed) {
    return (
      <TextWidget
        text={`✓ ${label}`}
        maxLines={1}
        style={{ fontSize: 11, fontWeight: 'bold', color: palette.accent, marginTop: 6 }}
      />
    );
  }

  return (
    <FlexWidget
      clickAction={CLICK_MARK_WATCHED}
      clickActionData={{
        showId: episode.showId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      }}
      style={{
        width: 'match_parent',
        height: 28,
        borderRadius: 14,
        backgroundColor: palette.accent,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 6,
      }}>
      <TextWidget
        text={`✓ ${label}`}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 11, fontWeight: 'bold', color: palette.accentText }}
      />
    </FlexWidget>
  );
}

// ---------- Quiz ----------

function Quiz(props: WidgetViewProps & { compact: boolean }) {
  const { payload, palette, compact } = props;
  const quiz = payload?.quiz;

  if (!payload || !quiz) {
    return (
      <Message
        palette={palette}
        title={payload ? text(payload, 'quizTitle', 'Quiz do dia') : 'Quiz do dia'}
        subtitle={payload ? text(payload, 'quizNone', 'Nenhum quiz hoje') : null}
        uri={`${DEEP_LINK}/quiz`}
      />
    );
  }

  const headline = !quiz.hasQuestion
    ? text(payload, 'quizNone', 'Nenhum quiz hoje')
    : quiz.answeredToday
      ? text(payload, 'quizDone', 'Concluído hoje')
      : compact
        ? text(payload, 'quizPendingShort', 'Responda hoje')
        : text(payload, 'quizPending', 'Responda a pergunta de hoje');

  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: `${DEEP_LINK}/quiz` }}
        style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
        <TextWidget
          text={headline}
          maxLines={2}
          style={{ fontSize: compact ? 12 : 14, fontWeight: 'bold', color: palette.text }}
        />
        {quiz.currentStreak > 0 ? (
          <TextWidget
            text={text(
              payload,
              quiz.currentStreak === 1 ? 'quizStreakOne' : 'quizStreakOther',
              quiz.currentStreak === 1 ? '{n} dia seguido' : '{n} dias seguidos',
              quiz.currentStreak
            )}
            maxLines={1}
            style={{ fontSize: 10, fontWeight: 'bold', color: palette.gold, marginTop: 1 }}
          />
        ) : (
          <FlexWidget style={{ width: 0, height: 0 }} />
        )}
      </FlexWidget>
      <WeekStrip quiz={quiz} palette={palette} showLabels={!compact} />
    </FlexWidget>
  );
}

function WeekStrip({
  quiz,
  palette,
  showLabels,
}: {
  quiz: WidgetQuiz;
  palette: WidgetPalette;
  showLabels: boolean;
}) {
  const days = quiz.week ?? [];
  if (days.length === 0) return <FlexWidget style={{ width: 0, height: 0 }} />;
  const size = showLabels ? 18 : 14;

  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
      {days.map((day) => (
        <FlexWidget
          key={day.label}
          style={{ flex: 1, flexDirection: 'column', alignItems: 'center' }}>
          <FlexWidget
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: day.correct
                ? palette.accent
                : day.answered
                  ? palette.danger
                  : palette.card,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <TextWidget
              text={day.answered ? (day.correct ? '✓' : '✕') : ' '}
              style={{ fontSize: size * 0.55, fontWeight: 'bold', color: palette.accentText }}
            />
          </FlexWidget>
          {showLabels ? (
            <TextWidget
              text={day.label}
              maxLines={1}
              style={{ fontSize: 8, color: palette.textSecondary, marginTop: 2 }}
            />
          ) : (
            <FlexWidget style={{ width: 0, height: 0 }} />
          )}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

// ---------- Contagem regressiva ----------

/**
 * Mesma regra do Countdown.swift: a TMDB só informa o dia, então a conta vai
 * até a meia-noite local, e as horas só aparecem na reta final.
 */
function countdownLabel(episode: WidgetEpisode, payload: WidgetPayload): string | null {
  if (!episode.airDate) return null;
  const airDay = new Date(`${episode.airDate}T00:00:00`);
  if (Number.isNaN(airDay.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((airDay.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days <= 0) return text(payload, 'today', 'Hoje!');

  const ms = airDay.getTime() - now.getTime();
  if (ms < 3_600_000) {
    return text(payload, 'inMinutes', 'Em {n}min', Math.max(1, Math.floor(ms / 60_000)));
  }
  if (ms < 6 * 3_600_000) {
    return text(payload, 'inHours', 'Em {n}h', Math.floor(ms / 3_600_000));
  }
  if (days === 1) return text(payload, 'tomorrow', 'Amanhã');
  return text(payload, 'inDays', 'Em {n} dias', days);
}
