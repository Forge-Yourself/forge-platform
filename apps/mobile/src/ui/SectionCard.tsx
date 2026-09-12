import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type SectionCardProps = {
  children: ReactNode;
};

/**
 * Groups a list of ListRows. Auto-marks the last child `isLast` so ListRow suppresses its
 * own bottom divider — screens never have to compute that themselves.
 */
export function SectionCard({ children }: SectionCardProps) {
  const t = useTheme();
  const items = Children.toArray(children);

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: t.colors.surfaceRaised,
        overflow: 'hidden',
      }}
    >
      {items.map((child, i) => {
        if (!isValidElement(child)) return child;
        const isLast = i === items.length - 1;
        return cloneElement(child as React.ReactElement<{ isLast?: boolean }>, {
          isLast,
          key: child.key ?? i,
        });
      })}
    </View>
  );
}
