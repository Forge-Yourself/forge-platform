import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The uppercase rule above a card group — PREFERENCES, COACHING CUES, WAIVER.
 * One component so the tracking and the 4pt side inset never drift between screens.
 */
export function SectionLabel({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: t.colors.textMuted,
        paddingHorizontal: 4,
      }}
    >
      {children}
    </Text>
  );
}
