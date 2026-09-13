import { Image, View } from 'react-native';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type AvatarProps = {
  /** Used for the initials and for picking the tint — never rendered as text itself. */
  name: string | null | undefined;
  /** Photo URL when one exists; initials are the fallback, not a placeholder. */
  photoUrl?: string | null;
  size?: number;
};

/** "Maya Khoury" → MK, "maya" → MA, "" → ?. Punctuation and extra words are ignored. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Three tints, picked deterministically from the name so one person keeps the same
 * colour everywhere they appear — roster row, program card, detail header.
 *
 * Every pair is one of packages/shared's contrast-verified surface/on-surface role
 * pairs, so the initials clear 4.5:1 in both schemes without this component
 * introducing a single new colour value. Deliberately three and not more: the
 * `surfaceSunken` pair reads as no disc at all on a card, and the danger pair would
 * make an arbitrary third of the roster look like a problem.
 */
function tintFor(t: Theme, name: string | null | undefined) {
  const pairs = [
    { bg: t.colors.accentSurfaceSoft, fg: t.colors.onAccentSurfaceSoft },
    { bg: t.colors.successSurface, fg: t.colors.onSuccessSurface },
    { bg: t.colors.warnSurface, fg: t.colors.onWarnSurface },
  ];
  const key = (name ?? '').trim();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  return pairs[hash % pairs.length];
}

export function Avatar({ name, photoUrl, size = 42 }: AvatarProps) {
  const t = useTheme();
  const { bg, fg } = tintFor(t, name);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.34), fontWeight: '700', color: fg }}>
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}
