import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

const LABELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const;

export type PasswordStrengthProps = {
  /** From @forge/shared's passwordStrength(password). */
  strength: 0 | 1 | 2 | 3;
};

/**
 * Three segments. Color signals strength but the accessibilityLabel carries the same
 * information in text so the indicator isn't color-only (WCAG 1.4.1).
 */
export function PasswordStrength({ strength }: PasswordStrengthProps) {
  const t = useTheme();
  const label = LABELS[strength] ?? 'weak';

  return (
    <View
      accessibilityLabel={`Password strength: ${label}`}
      style={{ flexDirection: 'row', gap: 4 }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < strength ? t.colors.successAccent : t.colors.border,
          }}
        />
      ))}
    </View>
  );
}
