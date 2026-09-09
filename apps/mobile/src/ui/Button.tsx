import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost';
};

export function Button({ label, variant = 'primary', style, ...rest }: ButtonProps) {
  const t = useTheme();
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={(state) => [
        styles.base,
        {
          minHeight: t.touchTarget,
          minWidth: t.touchTarget,
          paddingHorizontal: t.space[5],
          paddingVertical: t.space[3],
          borderRadius: t.radius.md,
          backgroundColor: isPrimary ? t.colors.primary : 'transparent',
          borderWidth: isPrimary ? 0 : 1.5,
          borderColor: t.colors.borderStrong,
          opacity: state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Text variant="bodyBold" tone={isPrimary ? 'onPrimary' : 'primary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
