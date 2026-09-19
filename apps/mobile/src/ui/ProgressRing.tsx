import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export type ProgressRingProps = {
  size: number;
  stroke: number;
  /** 0 → 1, clockwise from twelve o'clock. */
  progress: number;
  color: string;
  trackColor: string;
  children?: ReactNode;
};

/**
 * The rest-timer ring (prototype `session` strip and `timer`). Always a
 * secondary cue: every place it appears also prints the time in mono.
 */
export function ProgressRing({ size, stroke, progress, color, trackColor, children }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        {p > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - p)}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}
