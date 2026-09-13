import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

export type TextLinkProps = {
  /** The plain half — "No account?" */
  prefix: string;
  /** The tappable half — "Sign up". Rendered in ember at 700. */
  action: string;
  onPress: () => void;
};

/**
 * A sentence with one tappable word in it: "No account? **Sign up**".
 *
 * The auth screens used a full-width `Button` for this, which drew a control the
 * size of a real action at the foot of a screen whose only real action is the
 * ember CTA above it. The artboard draws a line of 13px muted copy with the verb
 * in ember — so that is what this is. React Native nests the press target inside
 * the sentence, so the tap area is the word, not the row.
 */
export function TextLink({ prefix, action, onPress }: TextLinkProps) {
  const t = useTheme();

  return (
    <Text style={{ fontSize: 13, textAlign: 'center', color: t.colors.textMuted }}>
      {prefix}{' '}
      <Text
        accessibilityRole="link"
        accessibilityLabel={`${prefix} ${action}`}
        onPress={onPress}
        suppressHighlighting
        style={{ fontSize: 13, fontWeight: '700', color: t.colors.accentText }}
      >
        {action}
      </Text>
    </Text>
  );
}
