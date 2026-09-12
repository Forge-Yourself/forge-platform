import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type NumericKeypadProps = {
  onKey: (digit: string) => void;
  onDelete: () => void;
  /**
   * Fills the otherwise-empty bottom-left slot. M3's builder passes a decimal
   * point for the RPE cell — target_rpe is NUMERIC(3,1), so "7.5" is a real
   * value a PT needs to type, not a nicety. Omitted, the transparent spacer
   * stays exactly as MFA entry has always rendered it.
   */
  extraKey?: { label: string; onPress: () => void };
};

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * Generic 3-column numeric keypad. Reused by MFA/TOTP entry and (in M4) weight entry —
 * deliberately has no knowledge of what it's feeding, only onKey/onDelete callbacks.
 */
export function NumericKeypad({ onKey, onDelete, extraKey }: NumericKeypadProps) {
  const t = useTheme();

  const keyStyle = {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return (
    <View style={{ gap: 8 }}>
      {ROWS.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((digit) => (
            <Pressable
              key={digit}
              accessibilityRole="button"
              accessibilityLabel={digit}
              onPress={() => onKey(digit)}
              style={keyStyle}
            >
              <Text numeric style={{ fontSize: 20, fontWeight: '700' }}>
                {digit}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {extraKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={extraKey.label}
            onPress={extraKey.onPress}
            style={keyStyle}
          >
            <Text numeric style={{ fontSize: 20, fontWeight: '700' }}>
              {extraKey.label}
            </Text>
          </Pressable>
        ) : (
          <View style={[keyStyle, { backgroundColor: 'transparent' }]} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="0"
          onPress={() => onKey('0')}
          style={keyStyle}
        >
          <Text numeric style={{ fontSize: 20, fontWeight: '700' }}>
            0
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete"
          onPress={onDelete}
          style={keyStyle}
        >
          <Text numeric style={{ fontSize: 20, fontWeight: '700' }}>
            ⌫
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
