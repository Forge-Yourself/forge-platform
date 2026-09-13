import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type DividerProps = {
  /** Centred cap — "OR" between two ways of doing the same thing. Omit for a plain rule. */
  label?: string;
};

/** A 1px rule, optionally broken by a centred uppercase cap. */
export function Divider({ label }: DividerProps) {
  const t = useTheme();
  const line = { flex: 1, height: 1, backgroundColor: t.colors.border };

  if (!label) return <View style={line} />;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[3] }}>
      <View style={line} />
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: t.colors.textMuted,
        }}
      >
        {label}
      </Text>
      <View style={line} />
    </View>
  );
}
