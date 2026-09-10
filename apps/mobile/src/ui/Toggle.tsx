import { Switch, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ToggleProps = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

/** Themed wrapper around RN's Switch. */
export function Toggle({ label, value, onValueChange, disabled }: ToggleProps) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: t.touchTarget,
        gap: t.space[3],
      }}
    >
      <Text style={{ flex: 1, fontSize: 15 }}>{label}</Text>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: t.colors.accent, false: t.colors.border }}
        thumbColor={t.colors.surfaceRaised}
      />
    </View>
  );
}
