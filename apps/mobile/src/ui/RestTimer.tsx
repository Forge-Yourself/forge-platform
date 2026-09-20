import { colorSchemes } from '@forge/shared';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { ProgressRing } from './ProgressRing';
import { Text } from './Text';

export type RestTimerState = 'running' | 'paused' | 'complete';

export type RestTimerLabels = {
  kicker: string;
  exercise: string;
  hint: string;
  state: Record<RestTimerState, string>;
  pause: string;
  resume: string;
  plus30: string;
  skip: string;
  back: string;
};

export type RestTimerProps = {
  phase: RestTimerState;
  /** Whole seconds left. */
  remaining: number;
  /** 0 → 1 as the rest elapses. */
  progress: number;
  labels: RestTimerLabels;
  onToggle: () => void;
  onPlus30: () => void;
  onSkip: () => void;
  /** "Back to set" — closes the full-screen view once the rest is over. */
  onDone: () => void;
  /** One line above Pause/+30s when the lock screen cannot do its job (M4d Corrections §6.4). */
  notice?: { text: string; actionLabel: string; onAction: () => void } | null;
};

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Prototype `timer` artboard: dark surface regardless of theme (read across a
 * gym), 52px mono time, ring as a secondary cue. Presentational — the clock
 * lives in the persisted rest store (useRest), so the inline strip, this view
 * and the lock screen all show one rest.
 */
export function RestTimer({ phase, remaining, progress, labels, onToggle, onPlus30, onSkip, onDone, notice }: RestTimerProps) {
  const t = useTheme();
  const dark = colorSchemes.dark;
  const fg = phase === 'complete' ? dark.successAccent : phase === 'paused' ? dark.textSecondary : dark.accent;

  return (
    <View style={{ flex: 1, backgroundColor: dark.surfaceSunken, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: dark.accentText, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4 }}>{labels.kicker}</Text>
          <Text numberOfLines={1} style={{ color: dark.textPrimary, fontSize: 16, fontWeight: '700' }}>
            {labels.exercise}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onSkip}
          style={{
            backgroundColor: dark.surfaceRaised,
            borderRadius: t.radius.pill,
            paddingHorizontal: 14,
            minHeight: 40,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: dark.textSecondary, fontWeight: '600', fontSize: 12 }}>{labels.skip}</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <View style={{ width: 216, height: 216, borderRadius: 108, backgroundColor: dark.surface }}>
          <ProgressRing size={216} stroke={6} progress={progress} color={fg} trackColor={dark.surfaceRaised}>
            <View style={{ alignItems: 'center' }}>
              <Text
                numeric
                style={{ color: fg, fontSize: 52, fontWeight: '700', lineHeight: 56 }}
              >
                {formatClock(remaining)}
              </Text>
              <Text style={{ color: dark.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 4 }}>
                {labels.state[phase]}
              </Text>
            </View>
          </ProgressRing>
        </View>
        <Text style={{ color: dark.textMuted, textAlign: 'center', maxWidth: 250, fontSize: 13.5 }}>{labels.hint}</Text>
      </View>

      {notice ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 10 }}>
          <Text style={{ color: dark.textMuted, fontSize: 12.5 }}>{notice.text}</Text>
          <Button label={notice.actionLabel} variant="link" onPress={notice.onAction} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={phase === 'complete' ? onDone : onToggle}
          style={{
            flex: 1,
            minHeight: 56,
            borderRadius: 12,
            backgroundColor: phase === 'complete' ? dark.successAccent : dark.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: dark.onAccent, fontSize: 16, fontWeight: '700' }}>
            {phase === 'complete' ? labels.back : phase === 'paused' ? labels.resume : labels.pause}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onPlus30}
          style={{
            minHeight: 56,
            paddingHorizontal: 20,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: dark.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text numeric style={{ color: dark.textPrimary, fontSize: 15, fontWeight: '700' }}>
            {labels.plus30}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
