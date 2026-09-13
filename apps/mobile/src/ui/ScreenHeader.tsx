import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ScreenHeaderProps = {
  title: string;
  /** The one action a top-level list screen offers — an IconButton or a ghost pill. */
  action?: ReactNode;
  /** Search box, segmented control, filter chips — anything that stays put while the list scrolls. */
  children?: ReactNode;
};

/**
 * The title block of a top-level tab screen.
 *
 * It sits OUTSIDE the list's scroll view on purpose. Previously the title, the
 * search box and the filters all scrolled away with the rows, so on a long roster
 * you could not see what you had searched for or which filter was on without
 * scrolling back to the top.
 *
 * 27/800/-0.5 is the design's screen title — larger and tighter than `h2`, which
 * is a section heading and was standing in for it.
 */
export function ScreenHeader({ title, action, children }: ScreenHeaderProps) {
  const t = useTheme();

  return (
    <View style={{ paddingHorizontal: t.space[5], paddingTop: t.space[2], paddingBottom: t.space[3], gap: t.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space[3] }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, fontSize: 27, fontWeight: '800', letterSpacing: -0.5 }}
        >
          {title}
        </Text>
        {action ?? null}
      </View>
      {children}
    </View>
  );
}
