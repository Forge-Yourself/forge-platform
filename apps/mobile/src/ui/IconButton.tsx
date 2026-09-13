import { Pressable, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = Omit<PressableProps, 'children'> & {
  icon: IconName;
  /** Required — an icon-only control announces nothing without it. */
  accessibilityLabel: string;
  /**
   * `accent` — the filled ember circle a list screen puts its one create action in.
   * `ghost`  — bordered circle for a secondary action (Settings on Today).
   * `plain`  — no chrome at all, for a control inside an already-bordered row.
   */
  variant?: 'accent' | 'ghost' | 'plain';
  size?: number;
};

/** Round 44pt control. The prototype's header "+" is this, not a text button. */
export function IconButton({
  icon,
  variant = 'accent',
  size = 44,
  disabled,
  style,
  ...rest
}: IconButtonProps) {
  const t = useTheme();
  const color =
    variant === 'accent' ? t.colors.onAccent : variant === 'ghost' ? t.colors.textPrimary : t.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled: disabled === true }}
      {...rest}
      style={(state) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: variant === 'accent' ? t.colors.accent : 'transparent',
          borderWidth: variant === 'ghost' ? 1.5 : 0,
          borderColor: t.colors.borderStrong,
          opacity: disabled ? 0.45 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} strokeWidth={2} />
    </Pressable>
  );
}
