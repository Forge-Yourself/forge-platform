import { colorSchemes } from '@forge/shared';
import { Pressable, View } from 'react-native';
import { ProgressRing } from './ProgressRing';
import { formatClock, type RestTimerState } from './RestTimer';
import { Text } from './Text';

export type RestStripProps = {
  phase: RestTimerState;
  remaining: number;
  progress: number;
  /** "Rest · set 3 of 4" */
  caption: string;
  plus30Label: string;
  skipLabel: string;
  /** Accessibility label for the tap target that opens the full-screen timer. */
  expandLabel: string;
  onExpand: () => void;
  onPlus30: () => void;
  onSkip: () => void;
};

/**
 * Prototype `session`: the inline rest strip under the set rows. Dark in both
 * themes, like the full-screen timer it opens — it is read at arm's length.
 * Ring, time and caption are one target that expands to prototype `timer`.
 */
export function RestStrip({
  phase,
  remaining,
  progress,
  caption,
  plus30Label,
  skipLabel,
  expandLabel,
  onExpand,
  onPlus30,
  onSkip,
}: RestStripProps) {
  const dark = colorSchemes.dark;
  const fg = phase === 'complete' ? dark.successAccent : phase === 'paused' ? dark.textSecondary : dark.accent;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: dark.surfaceSunken,
        borderWidth: 1,
        borderColor: dark.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expandLabel}
        onPress={onExpand}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
      >
        <ProgressRing size={44} stroke={5} progress={progress} color={fg} trackColor={dark.border} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numeric style={{ color: fg, fontSize: 20, fontWeight: '700', lineHeight: 22 }}>
            {formatClock(remaining)}
          </Text>
          <Text numberOfLines={1} style={{ color: dark.textMuted, fontSize: 11, fontWeight: '500', marginTop: 3 }}>
            {caption}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onPlus30}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: 10,
          borderWidth: 1.5,
          borderColor: dark.borderStrong,
          justifyContent: 'center',
        }}
      >
        <Text numeric style={{ color: dark.textPrimary, fontSize: 13, fontWeight: '700' }}>
          {plus30Label}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onSkip}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: dark.border,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: dark.textPrimary, fontSize: 13, fontWeight: '700' }}>{skipLabel}</Text>
      </Pressable>
    </View>
  );
}
