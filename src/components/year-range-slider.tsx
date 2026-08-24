import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  PanResponder,
  type PanResponderGestureState,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const THUMB = 22;

interface YearRangeSliderProps {
  min: number;
  max: number;
  from: number;
  to: number;
  /** Chamado a cada movimento; `from` nunca passa de `to`. */
  onChange: (from: number, to: number) => void;
}

/**
 * Linha de dois marcadores para escolher um ano só (marcadores juntos) ou um
 * intervalo. Usa PanResponder em vez do gesture-handler porque o slider vive
 * dentro de um Modal do React Native, onde os gestos da lib não chegam no
 * Android.
 */
export function YearRangeSlider({ min, max, from, to, onChange }: YearRangeSliderProps) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  // Refs espelham o estado para o PanResponder (criado uma única vez) enxergar
  // sempre os valores atuais.
  const widthRef = useRef(0);
  const fromRef = useRef(from);
  const toRef = useRef(to);
  const onChangeRef = useRef(onChange);
  const grantX = useRef(0);
  const dragging = useRef<'from' | 'to'>('from');

  // Sincroniza em efeito (não no corpo do render) porque o React Compiler está
  // ligado e escrever em ref durante o render quebra as regras do React.
  useEffect(() => {
    fromRef.current = from;
    toRef.current = to;
    onChangeRef.current = onChange;
  });

  const span = Math.max(1, max - min);

  const responder = useMemo(() => {
    function valueAt(x: number) {
      const width = widthRef.current;
      if (width <= 0) return min;
      const ratio = Math.min(1, Math.max(0, x / width));
      return min + Math.round(ratio * span);
    }

    function move(x: number) {
      const value = valueAt(x);
      if (dragging.current === 'from') {
        onChangeRef.current(Math.min(value, toRef.current), toRef.current);
      } else {
        onChangeRef.current(fromRef.current, Math.max(value, fromRef.current));
      }
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Impede que a rolagem do sheet roube o gesto no meio do arrasto.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        grantX.current = event.nativeEvent.locationX;
        const value = valueAt(grantX.current);
        // Toque solto na linha move o marcador mais próximo; com os dois no
        // mesmo ano, o lado do toque decide qual sai do lugar.
        const distanceToFrom = Math.abs(value - fromRef.current);
        const distanceToTo = Math.abs(value - toRef.current);
        if (distanceToFrom === distanceToTo) {
          dragging.current = value < fromRef.current ? 'from' : 'to';
        } else {
          dragging.current = distanceToFrom < distanceToTo ? 'from' : 'to';
        }
        move(grantX.current);
      },
      onPanResponderMove: (_event, gesture: PanResponderGestureState) => {
        move(grantX.current + gesture.dx);
      },
    });
  }, [min, span]);

  function handleLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    widthRef.current = width;
    setTrackWidth(width);
  }

  const fromX = ((from - min) / span) * trackWidth;
  const toX = ((to - min) / span) * trackWidth;

  return (
    <View>
      <View style={styles.hitArea} {...responder.panHandlers} onLayout={handleLayout}>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.trackFill,
              { backgroundColor: theme.accent, left: fromX, width: Math.max(0, toX - fromX) },
            ]}
          />
        </View>
        {([fromX, toX] as const).map((x, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                backgroundColor: theme.accent,
                borderColor: theme.background,
                left: x - THUMB / 2,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.bounds}>
        <ThemedText type="small" themeColor="textSecondary">
          {min}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {max}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    height: 44,
    justifyContent: 'center',
    // Margem lateral do raio do marcador: nas pontas ele fica inteiro dentro
    // do sheet, e a linha medida no onLayout bate com a área arrastável.
    marginHorizontal: THUMB / 2,
  },
  track: {
    height: 4,
    borderRadius: 2,
  },
  trackFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
  },
  bounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    marginHorizontal: THUMB / 2,
  },
});
