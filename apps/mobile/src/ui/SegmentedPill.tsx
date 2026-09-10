import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type SegmentedPillItem = {
  label: string;
  value: string;
  disabled?: boolean;
  disabledLabel?: string;
};

export type SegmentedPillProps = {
  items: SegmentedPillItem[];
  selected: string;
  onChange: (value: string) => void;
};

/**
 * Segmented control. Supports a disabled item (e.g. "SMS" pending a future release) that
 * shows a badge and never responds to taps.
 */
export function SegmentedPill({ items, selected, onChange }: SegmentedPillProps) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.colors.surfaceRaised,
        borderRadius: t.radius.pill,
        padding: 4,
        gap: 4,
      }}
    >
      {items.map((item) => {
        const isSelected = item.value === selected;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityLabel={item.disabled ? `${item.label}, ${item.disabledLabel ?? 'Coming soon'}` : item.label}
            accessibilityState={{ selected: isSelected, disabled: !!item.disabled }}
            disabled={item.disabled}
            onPress={() => !item.disabled && onChange(item.value)}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: t.radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              backgroundColor: isSelected ? t.colors.accent : 'transparent',
              opacity: item.disabled ? 0.5 : 1,
            }}
          >
            <Text
              style={{ fontSize: 13, fontWeight: '700' }}
              tone={isSelected ? 'onAccent' : 'primary'}
            >
              {item.label}
            </Text>
            {item.disabled && (
              <Text style={{ fontSize: 10, fontWeight: '700' }} tone="muted">
                {(item.disabledLabel ?? 'Coming soon').toUpperCase()}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
