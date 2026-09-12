import { useEffect, useState } from 'react';
import { Animated, type DimensionValue } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
};

/** Pulsing placeholder rectangle for loading states. */
export function Skeleton({ width = '100%', height = 16, radius = 6 }: SkeletonProps) {
  const t = useTheme();
  // useState (not useRef) so the Animated.Value isn't read from a ref during render —
  // the react-hooks/refs lint rule forbids that.
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessible
      accessibilityLabel="Loading content"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: t.colors.surfaceSunken,
        opacity,
      }}
    />
  );
}
