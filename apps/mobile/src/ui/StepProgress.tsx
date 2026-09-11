import { motion } from '@forge/shared';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type StepProgressProps = {
  /** 0 to 1. */
  progress: number;
  /** e.g. "Step 2 of 4" — a visual-only bar is inaccessible without this. */
  label: string;
  /**
   * Render as `segments` separate bars instead of one continuous fill — "step
   * count is the honest signal of remaining work", per M2's intake annotation,
   * not a percentage. Each segment fills solid once `progress` reaches its
   * share; there's no partial-segment animation, matching the design's plain
   * filled/unfilled treatment. Omit for M1's original continuous bar.
   */
  segments?: number;
};

const [x1, y1, x2, y2] = motion.easing;

/**
 * Thin progress bar. Uses RN's built-in Animated API (react-native-reanimated is a listed
 * dependency but isn't wired up with its babel plugin anywhere in this app yet, so the
 * built-in API is the consistent choice here).
 */
export function StepProgress({ progress, label, segments }: StepProgressProps) {
  const t = useTheme();
  // useState (not useRef) so the Animated.Value isn't read from a ref during render —
  // the react-hooks/refs lint rule forbids that.
  const [anim] = useState(() => new Animated.Value(progress));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: progress,
      duration: motion.slow,
      easing: Easing.bezier(x1, y1, x2, y2),
      useNativeDriver: false,
    }).start();
  }, [progress, anim]);

  if (segments && segments > 0) {
    const filledCount = Math.round(progress * segments);
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', gap: t.space[1] }}
      >
        {Array.from({ length: segments }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i < filledCount ? t.colors.accent : t.colors.border,
            }}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: t.colors.border,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: 2,
          backgroundColor: t.colors.accent,
          width: anim.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
            extrapolate: 'clamp',
          }),
        }}
      />
    </View>
  );
}
