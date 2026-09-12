import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type BuilderBlockProps = {
  /** Block marker: A, B, C… The rows inside carry A1, A2 and so on. */
  tag: string;
  title: string;
  /** Already-formatted rest line, e.g. "REST 3:00". Omitted when none is prescribed. */
  rest?: string | null;
  children: ReactNode;
};

/**
 * A block of prescribed work — "Main lift", a superset, a finisher — wrapping
 * one or more BuilderRows.
 *
 * A superset is not a separate concept in the schema: it is a block whose
 * block_type is 'superset' and whose rows are slotted A1/A2. That is why this
 * component takes a plain tag and title rather than a block type, and why the
 * database needed no superset flag beyond the CHECK value it already had.
 */
export function BuilderBlock({ tag, title, rest, children }: BuilderBlockProps) {
  const t = useTheme();

  return (
    <View
      accessible={false}
      style={{
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: t.colors.surfaceRaised,
        paddingHorizontal: t.space[3],
        paddingBottom: t.space[2],
      }}
    >
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={[tag, title, rest].filter(Boolean).join(', ')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space[2],
          paddingTop: t.space[3],
          paddingBottom: t.space[2],
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
        }}
      >
        <View
          style={{
            minWidth: 22,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.accentSurfaceSoft,
            alignItems: 'center',
          }}
        >
          <Text
            numeric
            style={{
              fontSize: 11,
              fontWeight: '700',
              lineHeight: 16,
              color: t.colors.onAccentSurfaceSoft,
            }}
          >
            {tag}
          </Text>
        </View>

        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700' }}>
          {title}
        </Text>

        {rest ? (
          <Text numeric tone="muted" style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
            {rest}
          </Text>
        ) : null}
      </View>

      {children}
    </View>
  );
}
