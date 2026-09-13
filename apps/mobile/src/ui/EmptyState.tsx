import { View } from 'react-native';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  body: string;
  /** `danger` is the offline/failure case — same layout, a red disc instead of a tile. */
  tone?: 'neutral' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
  /** Failure recovery is a ghost "Try again", not a second ember CTA. */
  actionVariant?: 'primary' | 'ghost';
};

function discRoles(t: Theme, tone: 'neutral' | 'danger') {
  return tone === 'danger'
    ? { bg: t.colors.dangerSurface, fg: t.colors.onDangerSurface, radius: 28 }
    : { bg: t.colors.surfaceSunken, fg: t.colors.textMuted, radius: 18 };
}

/**
 * Empty, no-match and error states. All three were separate ad-hoc stacks of a
 * bare h3 + body + button on five different screens, which is why none of them
 * had the prototype's icon disc and no two used the same vertical rhythm.
 */
export function EmptyState({
  icon,
  title,
  body,
  tone = 'neutral',
  actionLabel,
  onAction,
  actionVariant = 'primary',
}: EmptyStateProps) {
  const t = useTheme();
  const disc = discRoles(t, tone);

  return (
    <View style={{ alignItems: 'center', paddingVertical: t.space[9], paddingHorizontal: t.space[6] }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: disc.radius,
          backgroundColor: disc.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: t.space[4],
        }}
      >
        <Icon name={icon} size={26} color={disc.fg} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 }}>{title}</Text>
      <Text
        tone="secondary"
        style={{ fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginBottom: t.space[5] }}
      >
        {body}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant={actionVariant} onPress={onAction} />
      ) : null}
    </View>
  );
}
