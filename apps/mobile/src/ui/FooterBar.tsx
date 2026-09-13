import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The pinned action bar at the foot of a detail screen — Start session, Add to
 * program, Generate draft.
 *
 * These used to sit at the bottom of the scroll body, so on a long client detail
 * or exercise page the primary action was below the fold and had to be scrolled
 * to. Pinned, it is always in the bottom third, which is the gym-floor
 * one-handed-reach constraint the design brief sets.
 */
export function FooterBar({ children }: { children: ReactNode }) {
  const t = useTheme();

  return (
    <View
      style={{
        paddingHorizontal: t.space[4],
        paddingTop: t.space[3],
        paddingBottom: t.space[5],
        gap: t.space[2],
        borderTopWidth: 1,
        borderTopColor: t.colors.border,
        backgroundColor: t.colors.surface,
      }}
    >
      {children}
    </View>
  );
}
