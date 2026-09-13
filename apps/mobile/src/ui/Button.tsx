import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  /**
   * `primary` — the one filled ember CTA. At most one per viewport.
   * `ghost`   — a real secondary action: 1.5pt bordered, same footprint as primary.
   * `link`    — navigation and dismissal (Back, Cancel, Skip). Borderless text, no
   *             box: the prototype never draws a border around a Cancel, and a
   *             bordered one reads as a third competing action next to the CTA.
   */
  variant?: 'primary' | 'ghost' | 'link';
  /**
   * `danger` recolours ghost/link for destructive actions (Deactivate, Discard).
   * `accent` promotes a link to the ember affordance a header Save needs, without
   * giving it the footprint of a filled button in a 52pt header row.
   */
  tone?: 'default' | 'danger' | 'accent';
  /** md (44pt, default) matches the base touch target; lg (52pt) is the design's primary CTA size. */
  size?: 'md' | 'lg';
  /** Leading glyph, drawn from the SVG set at the label's own colour. */
  icon?: IconName;
  /** Swaps the label for a spinner and blocks presses — for in-flight submits. */
  loading?: boolean;
};

export function Button({
  label,
  variant = 'primary',
  tone = 'default',
  size = 'md',
  icon,
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const isPrimary = variant === 'primary';
  const isLink = variant === 'link';
  const isLg = size === 'lg';
  const isDanger = tone === 'danger';
  const isAccentTone = tone === 'accent';
  const isDisabled = disabled === true || loading;

  // The design's one filled CTA style is `.btn-accent` (ember-700/white in light,
  // verified 5.28:1 — see M1's token reconciliation), not the separate
  // `primary`/`onPrimary` role pair. `variant="primary"` names the button's
  // PURPOSE (the primary action), not a colour role.
  const labelColor = isPrimary
    ? t.colors.onAccent
    : isDanger
      ? t.colors.dangerAccent
      : isAccentTone
        ? t.colors.accentText
        : isLink
          ? t.colors.textSecondary
          : t.colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      {...rest}
      style={(state) => [
        styles.base,
        {
          minHeight: isLink ? t.touchTarget : isLg ? 52 : t.touchTarget,
          minWidth: isLink ? undefined : t.touchTarget,
          paddingHorizontal: isLink ? t.space[2] : t.space[5],
          paddingVertical: isLink ? 0 : t.space[3],
          borderRadius: isLink ? t.radius.sm : t.radius.md,
          backgroundColor: isPrimary ? (isDanger ? t.colors.dangerAccent : t.colors.accent) : 'transparent',
          borderWidth: variant === 'ghost' ? 1.5 : 0,
          borderColor: isDanger
            ? t.colors.dangerAccent
            : isAccentTone
              ? t.colors.accent
              : t.colors.borderStrong,
          // Disabled used to render identically to enabled, so a submitting form's
          // CTA looked tappable while it silently swallowed every press. Loading dims
          // less than disabled: the work is in flight, not unavailable, and at 0.45
          // the spinner itself was barely visible on the ember fill.
          opacity: loading ? 0.7 : disabled ? 0.45 : state.pressed ? 0.85 : 1,
        },
        isLg && isPrimary && !isDisabled && styles.lgShadow,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={isLg ? 19 : 17} color={labelColor} /> : null}
          <Text
            variant="bodyBold"
            numberOfLines={1}
            style={[{ color: labelColor }, isLg ? styles.lgLabel : null, isLink ? styles.linkLabel : null]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  linkLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
