import { motion } from '@forge/shared';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type StepProgressProps = {
  /** 0 to 1. */
  progress: number;
  /** e.g. "Step 2 of 4" — a visual-only bar is inaccessible without this. */
  label: string;
};

const [x1, y1, x2, y2] = motion.easing;

/**
 * Thin progress bar. Uses RN's built-in Animated API (react-native-reanimated is a listed
 * dependency but isn't wired up with its babel plugin anywhere in this app yet, so the
 * built-in API is the consistent choice here).
 */
export function StepProgress({ progress, label }: StepProgressProps) {
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

  return (
    <View
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
