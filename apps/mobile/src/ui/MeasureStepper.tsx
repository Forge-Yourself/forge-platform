import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type MeasureStepperProps = {
  value: string;
  unit: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
};

/**
 * Prototype `metrics` entry: a ± stepper, not a keyboard — measurements move
 * in known increments. 52x56 side keys and an ember-bordered value cell, the
 * geometry the builder's numeric cell uses.
 */
export function MeasureStepper({
  value,
  unit,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  disabled = false,
}: MeasureStepperProps) {
  const theme = useTheme();
  const key = (label: string, glyph: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52,
        height: 56,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text variant="h2">{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      {key(decrementLabel, '−', onDecrement)}
      <View
        style={{
          flex: 1,
          height: 56,
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.surfaceRaised,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Text variant="h2" numeric>
          {value}
        </Text>
        <Text variant="caption" tone="muted">
          {unit}
        </Text>
      </View>
      {key(incrementLabel, '+', onIncrement)}
    </View>
  );
}
