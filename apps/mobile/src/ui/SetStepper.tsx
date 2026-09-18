import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type SetStepperProps = {
  /** Already-translated labels in the display unit: ['−5', '−1', '+1', '+5']. */
  steps: readonly { label: string; delta: number }[];
  onStep: (delta: number) => void;
  disabled?: boolean;
};

/**
 * The four nudge keys under the focus card's big number (DS mockup 04). 56pt
 * tall like the keypad — thumb-sized at arm's length. Labels are passed in
 * already formatted so the component knows nothing about units (PITFALLS I2).
 */
export function SetStepper({ steps, onStep, disabled }: SetStepperProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space[2] }}>
      {steps.map((s) => (
        <Pressable
          key={s.label}
          accessibilityRole="button"
          accessibilityLabel={s.label}
          disabled={disabled}
          onPress={() => onStep(s.delta)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 56,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.surfaceRaised,
            borderWidth: 1,
            borderColor: t.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Text numeric variant="bodyBold">
            {s.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
