import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type CodeCellsProps = {
  /** Up to 6 characters; each renders in its own cell. */
  code: string;
  length?: number;
};

/** 6-digit code display, pairs with NumericKeypad for the MFA challenge screen. */
export function CodeCells({ code, length = 6 }: CodeCellsProps) {
  const t = useTheme();
  const cells = Array.from({ length }, (_, i) => code[i] ?? '');

  return (
    <View
      accessibilityLabel={`Code entry, ${code.length} of ${length} digits entered`}
      style={{ flexDirection: 'row', gap: 8 }}
    >
      {cells.map((digit, i) => {
        const isActive = i === code.length;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              aspectRatio: 1 / 1.15,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: isActive ? t.colors.accent : t.colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text numeric style={{ fontSize: 22, fontWeight: '700' }}>
              {digit}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
