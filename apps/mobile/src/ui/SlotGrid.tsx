import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type SlotGridProps = {
  slots: { key: string; label: string }[];
  selected: string | null;
  /** Slot taken: the nearest open times are outlined (design, Book · Slot taken). */
  outlined?: string[];
  onSelect: (key: string) => void;
};

export function SlotGrid({ slots, selected, outlined = [], onSelect }: SlotGridProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {slots.map((s) => {
        const on = s.key === selected;
        const ring = outlined.includes(s.key);
        return (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(s.key)}
            style={{
              width: '23%',
              minHeight: t.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.md,
              borderWidth: ring || on ? 2 : 1,
              borderColor: on || ring ? t.colors.accent : t.colors.border,
              backgroundColor: on ? t.colors.accent : t.colors.surfaceRaised,
            }}
          >
            <Text numeric style={{ fontWeight: '600', color: on ? t.colors.onAccent : t.colors.textPrimary }}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
