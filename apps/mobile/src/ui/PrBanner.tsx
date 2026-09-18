import { useEffect } from 'react';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type PrBannerProps = {
  /** Already-translated lines, one per PR hit. Empty → renders nothing. */
  lines: readonly string[];
  onDismiss: () => void;
  durationMs?: number;
};

/**
 * The celebration moment (spec §6.3): an ember card slides over the focus card
 * for 2.5s and leaves. Never a modal — logging continues underneath.
 */
export function PrBanner({ lines, onDismiss, durationMs = 2500 }: PrBannerProps) {
  const t = useTheme();
  useEffect(() => {
    if (lines.length === 0) return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [lines, onDismiss, durationMs]);
  if (lines.length === 0) return null;
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(160)}
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: t.space[3],
        left: t.space[4],
        right: t.space[4],
        backgroundColor: t.colors.accent,
        borderRadius: t.radius.lg,
        padding: t.space[4],
        gap: 2,
      }}
    >
      {lines.map((line) => (
        <Text key={line} variant="bodyBold" style={{ color: t.colors.onAccent }}>
          {line}
        </Text>
      ))}
    </Animated.View>
  );
}
