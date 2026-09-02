import { useEffect, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Azul e amarelo do logo + algumas cores extras só pra dar variedade ao confete.
const DEFAULT_COLORS = ['#2E7CF0', '#F5C518', '#22C55E', '#F97316', '#EC4899', '#8B5CF6'];
const PARTICLE_COUNT = 28;

interface Particle {
  id: number;
  left: number;
  color: string;
  width: number;
  height: number;
  fallDistance: number;
  drift: number;
  rotations: number;
  duration: number;
  delay: number;
  progress: Animated.Value;
}

function makeParticles(colors: string[]): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const size = 6 + Math.random() * 6;
    return {
      id: index,
      left: Math.random() * SCREEN_WIDTH,
      color: colors[index % colors.length],
      width: size,
      height: size * 1.6,
      fallDistance: 380 + Math.random() * 260,
      drift: (Math.random() - 0.5) * 140,
      rotations: 1 + Math.random() * 2.5,
      duration: 1500 + Math.random() * 700,
      delay: Math.random() * 200,
      progress: new Animated.Value(0),
    };
  });
}

/**
 * Confete simples (sem lib nova, só Animated do RN) que cai do topo da tela.
 * Toda vez que `trigger` muda para um valor > 0, dispara uma nova leva —
 * usado ao responder o quiz do dia (ver src/app/quiz.tsx). `colors` troca a
 * paleta (festiva no acerto, mais fria no erro).
 */
export function ConfettiBurst({ trigger, colors }: { trigger: number; colors?: string[] }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (trigger === 0) return;
    const next = makeParticles(colors ?? DEFAULT_COLORS);
    setParticles(next);
    const animations = next.map((particle) =>
      Animated.timing(particle.progress, {
        toValue: 1,
        duration: particle.duration,
        delay: particle.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    Animated.parallel(animations).start(() => setParticles([]));
  }, [trigger, colors]);

  if (particles.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((particle) => {
        const translateY = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-20, particle.fallDistance],
        });
        const translateX = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.drift],
        });
        const rotate = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${particle.rotations * 360}deg`],
        });
        const opacity = particle.progress.interpolate({
          inputRange: [0, 0.85, 1],
          outputRange: [1, 1, 0],
        });
        return (
          <Animated.View
            key={particle.id}
            style={[
              styles.particle,
              {
                left: particle.left,
                width: particle.width,
                height: particle.height,
                backgroundColor: particle.color,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    top: 0,
    borderRadius: 2,
  },
});
