import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Avatar, thumbnail tile or status dot at the start of the row. */
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Suppresses the bottom divider — SectionCard sets this on the last child. */
  isLast?: boolean;
  /** Default 60 (the settings-row height). M2's client list rows are 68. */
  minHeight?: number;
  /**
   * Draws the `›` affordance after `trailing`. On by default for a row that pushes
   * a screen; pass false when the trailing slot is itself the control (a toggle, a
   * segmented pill) and the row does not navigate.
   */
  chevron?: boolean;
  /**
   * Blocks presses and dims the row, for a row whose onPress fires a request.
   *
   * ListRow started as a navigation/info row, so it had no such prop — and when
   * the client-detail screen's Resend invite was converted from a
   * `<Button disabled={submitting}>` to a ListRow, the in-flight guard was
   * silently dropped along with it: two taps sent two resend_invite RPCs, which
   * rotate the invite twice and write two audit rows.
   */
  disabled?: boolean;
};

/** One row of a SectionCard. Pressable when onPress is given, otherwise a static info row. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  isLast,
  minHeight = 60,
  chevron,
  disabled,
}: ListRowProps) {
  const t = useTheme();
  const Container = onPress ? Pressable : View;
  const showChevron = chevron ?? !!onPress;

  return (
    <Container
      {...(onPress
        ? {
            accessibilityRole: 'button' as const,
            // Title AND subtitle: the subtitle is where a row's actual state
            // lives ("3 red flags", "Invite sent"), and a label of the title
            // alone announced every such row as if it had none.
            accessibilityLabel: subtitle ? `${title}. ${subtitle}` : title,
            accessibilityState: { disabled: !!disabled },
            disabled,
            onPress,
          }
        : {})}
      style={{
        minHeight,
        opacity: disabled ? 0.5 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.space[3],
        paddingHorizontal: t.space[4],
        paddingVertical: t.space[2],
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: t.colors.border,
      }}
    >
      {leading ?? null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '400' }} tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
      {showChevron ? <Icon name="chevron" size={18} color={t.colors.textMuted} /> : null}
    </Container>
  );
}
