import { chartGeometry } from '@forge/shared';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TrendChartProps = {
  points: readonly { ms: number; value: number }[];
  startMs: number;
  endMs: number;
  /** Already-translated axis labels, four of them ("Wk 1" … "Wk 8"). */
  labels: string[];
  accessibilityLabel: string;
};

/**
 * Prototype `metrics` chart: trend line only — no bars, no grid — with a 10 %
 * ember area and a dot on the last point. Geometry lives in @forge/shared
 * (chartGeometry, tested); this only draws it.
 */
export function TrendChart({ points, startMs, endMs, labels, accessibilityLabel }: TrendChartProps) {
  const theme = useTheme();
  const g = chartGeometry(points, startMs, endMs);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.lg,
        paddingTop: 14,
        paddingHorizontal: 12,
        paddingBottom: 10,
      }}
    >
      <Svg viewBox="0 0 300 118" style={{ width: '100%', height: 118 }}>
        {g ? (
          <>
            <Polyline points={g.area} fill={theme.colors.accent} fillOpacity={0.1} stroke="none" />
            <Polyline
              points={g.line}
              fill="none"
              stroke={theme.colors.accent}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle cx={g.last.x} cy={g.last.y} r={5} fill={theme.colors.accent} stroke={theme.colors.surfaceRaised} strokeWidth={2} />
          </>
        ) : null}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {labels.map((l) => (
          <Text key={l} variant="caption" tone="muted" numeric style={{ fontSize: 9.5 }}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}
