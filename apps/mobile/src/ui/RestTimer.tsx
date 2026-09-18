import { colorSchemes } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
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
  /** Total rest in seconds; the timer runs from `startedAt` so background time counts. */
  seconds: number;
  startedAt: number;
  labels: RestTimerLabels;
  onDone: () => void;
  onSkip: () => void;
  onZero?: () => void;
};

/**
 * Prototype `timer` artboard: dark surface regardless of theme (read across a
 * gym), 52px mono time, ring as a secondary cue. The countdown is derived from
 * a target timestamp, not a decrementing counter, so a phone that sleeps for
 * 40s shows 40s less when it wakes. Pausing stores the remaining ms and
 * resuming sets a new target. Lock-screen persistence is M4d.
 */
export function RestTimer({ seconds, startedAt, labels, onDone, onSkip, onZero }: RestTimerProps) {
  const t = useTheme();
  const dark = colorSchemes.dark;
  const [target, setTarget] = useState(startedAt + seconds * 1000);
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const firedZero = useRef(false);

  const remainingMs = pausedRemaining ?? Math.max(0, target - now);
  const remaining = Math.ceil(remainingMs / 1000);
  const state: RestTimerState = pausedRemaining !== null ? 'paused' : remaining === 0 ? 'complete' : 'running';

  useEffect(() => {
    if (state !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state === 'complete' && !firedZero.current) {
      firedZero.current = true;
      onZero?.();
    }
  }, [state, onZero]);

  const total = Math.max(1, (target - startedAt) / 1000);
  const fraction = Math.min(1, Math.max(0, remainingMs / 1000 / total));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');
  const fg = state === 'complete' ? dark.successAccent : state === 'paused' ? dark.textSecondary : dark.accent;

  function toggle() {
    if (state === 'complete') {
      onDone();
      return;
    }
    if (pausedRemaining === null) {
      setPausedRemaining(remainingMs);
    } else {
      setTarget(Date.now() + pausedRemaining);
      setPausedRemaining(null);
      setNow(Date.now());
    }
  }

  function plus30() {
    if (pausedRemaining !== null) {
      setPausedRemaining(pausedRemaining + 30_000);
    } else {
      setTarget((v) => Math.max(v, Date.now()) + 30_000);
      firedZero.current = false;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: dark.surfaceSunken, padding: t.space[5], paddingBottom: t.space[6] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: dark.accentText, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4 }}>{labels.kicker}</Text>
          <Text variant="bodyBold" style={{ color: dark.textPrimary }}>
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

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space[3] }}>
        <View
          style={{
            width: 216,
            height: 216,
            borderRadius: 108,
            backgroundColor: dark.surface,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 6,
            borderColor: dark.surfaceRaised,
          }}
        >
          {/* Ring: a top arc whose opacity tracks the fraction. Secondary cue only — the number is the signal. */}
          <View
            style={{
              position: 'absolute',
              top: -6,
              left: -6,
              right: -6,
              bottom: -6,
              borderRadius: 108,
              borderWidth: 6,
              borderColor: 'transparent',
              borderTopColor: fg,
              opacity: 0.3 + 0.7 * fraction,
            }}
          />
          <Text numeric style={{ color: fg, fontSize: 52, fontWeight: '700', lineHeight: 56 }}>
            {mm}:{ss}
          </Text>
          <Text style={{ color: dark.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 4 }}>
            {labels.state[state]}
          </Text>
        </View>
        <Text style={{ color: dark.textMuted, textAlign: 'center', maxWidth: 250, fontSize: 13.5 }}>{labels.hint}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: t.space[3] }}>
        <Pressable
          accessibilityRole="button"
          onPress={toggle}
          style={{
            flex: 1,
            minHeight: 56,
            borderRadius: t.radius.md,
            backgroundColor: state === 'complete' ? dark.successAccent : dark.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="bodyBold" style={{ color: dark.onAccent, fontSize: 16 }}>
            {state === 'complete' ? labels.back : state === 'paused' ? labels.resume : labels.pause}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={plus30}
          style={{
            minHeight: 56,
            paddingHorizontal: 20,
            borderRadius: t.radius.md,
            borderWidth: 1.5,
            borderColor: dark.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text numeric variant="bodyBold" style={{ color: dark.textPrimary }}>
            {labels.plus30}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
