import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ChipRowProps = {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
};

/** Multi-select chip row (services, specializations, languages). */
export function ChipRow({ options, selected, onToggle }: ChipRowProps) {
  const t = useTheme();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onToggle(option)}
            style={{
              minHeight: 44,
              paddingVertical: 10,
              paddingHorizontal: 16,
              borderRadius: t.radius.pill,
              borderWidth: 1,
              borderColor: isSelected ? t.colors.accent : t.colors.border,
              backgroundColor: isSelected ? t.colors.accentSurfaceSoft : 'transparent',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: isSelected ? t.colors.onAccentSurfaceSoft : t.colors.textSecondary,
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
