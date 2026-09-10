import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ChoiceCardProps = {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
};

/**
 * Large tappable role-chooser card. Ghost-button styling; becomes ember-bordered with
 * ember-tinted title when selected (docs/Forge_DesignSystem.html ~L611-618).
 */
export function ChoiceCard({ title, subtitle, selected, onPress }: ChoiceCardProps) {
  const t = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderWidth: 1.5,
        borderColor: selected ? t.colors.accent : t.colors.borderStrong,
        borderRadius: t.radius.md,
        padding: t.space[4] + 2,
        gap: 4,
        minHeight: t.touchTarget,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '700' }} tone={selected ? 'accent' : 'primary'}>
        {title}
      </Text>
      <Text style={{ fontSize: 13, fontWeight: '400' }} tone="secondary">
        {subtitle}
      </Text>
    </Pressable>
  );
}
