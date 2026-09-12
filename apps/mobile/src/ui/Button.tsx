import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost';
  /** md (44pt, default) matches the base touch target; lg (52pt) is the design's primary CTA size. */
  size?: 'md' | 'lg';
};

export function Button({ label, variant = 'primary', size = 'md', style, ...rest }: ButtonProps) {
  const t = useTheme();
  const isPrimary = variant === 'primary';
  const isLg = size === 'lg';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={(state) => [
        styles.base,
        {
          minHeight: isLg ? 52 : t.touchTarget,
          minWidth: t.touchTarget,
          paddingHorizontal: t.space[5],
          paddingVertical: t.space[3],
          borderRadius: t.radius.md,
          // The design's one filled CTA style is `.btn-accent` (ember-700/white
          // in light, verified 5.28:1 — see Task 3's token reconciliation), not
          // the separate `primary`/`onPrimary` role pair. `variant="primary"`
          // names the button's PURPOSE (the primary action), not a color role.
          backgroundColor: isPrimary ? t.colors.accent : 'transparent',
          borderWidth: isPrimary ? 0 : 1.5,
          borderColor: t.colors.borderStrong,
          opacity: state.pressed ? 0.85 : 1,
        },
        isLg && isPrimary && styles.lgShadow,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Text
        variant="bodyBold"
        tone={isPrimary ? 'onAccent' : 'primary'}
        style={isLg ? styles.lgLabel : undefined}
      >
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
  lgShadow: {
    // Ember glow: 0 6px 16px rgba(232,99,26,.28)
    shadowColor: 'rgba(232,99,26,1)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  lgLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
});
