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
}: ListRowProps) {
  const t = useTheme();
  const Container = onPress ? Pressable : View;
  const showChevron = chevron ?? !!onPress;

  return (
    <Container
      {...(onPress
        ? { accessibilityRole: 'button' as const, accessibilityLabel: title, onPress }
        : {})}
      style={{
        minHeight,
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
