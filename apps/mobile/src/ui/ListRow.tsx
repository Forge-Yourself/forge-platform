import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Suppresses the bottom divider — SectionCard sets this on the last child. */
  isLast?: boolean;
};

/** Settings-screen row. Pressable when onPress is given, otherwise a static info row. */
export function ListRow({ title, subtitle, trailing, onPress, isLast }: ListRowProps) {
  const t = useTheme();
  const Container = onPress ? Pressable : View;

  return (
    <Container
      {...(onPress
        ? { accessibilityRole: 'button' as const, accessibilityLabel: title, onPress }
        : {})}
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.space[3],
        paddingHorizontal: t.space[4],
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: t.colors.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontSize: 12.5, fontWeight: '400' }} tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
    </Container>
  );
}
