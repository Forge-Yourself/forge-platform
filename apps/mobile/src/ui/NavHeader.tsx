import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type NavHeaderProps = {
  /**
   * Centred title. A string is styled for you; pass a node when the title needs
   * something beside the words (the AI screen's ember spark).
   */
  title?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** The 1px rule under a modal/edit header. Off for a plain back row on a detail screen. */
  divider?: boolean;
};

/**
 * Cancel · Title · Save — the header chrome for every pushed and modal screen.
 *
 * Every stack in this app sets `headerShown: false`, so each screen drew its own
 * header row by hand, and they all drifted: some used a bordered ghost button as
 * a back control, some a 64pt spacer to fake centring, some no title at all. The
 * leading and trailing slots here are a fixed 72pt so the title is optically
 * centred regardless of what either side holds.
 */
export function NavHeader({ title, leading, trailing, divider = true }: NavHeaderProps) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: t.space[3],
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: t.colors.border,
      }}
    >
      <View style={{ minWidth: 72, alignItems: 'flex-start' }}>{leading ?? null}</View>
      {typeof title === 'string' ? (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700' }}
        >
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{title ?? null}</View>
      )}
      <View style={{ minWidth: 72, alignItems: 'flex-end' }}>{trailing ?? null}</View>
    </View>
  );
}
