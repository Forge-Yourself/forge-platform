import { Image, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../../ui';
import { initialsFor } from './initials';

export type AvatarProps = {
  displayName: string | null | undefined;
  /** Photo URL, if one was pasted in profile-edit — M1 accepts a URL string only (no
   * upload; Storage buckets land in M4). Renders initials whenever this is absent. */
  photoUrl?: string | null;
  size?: number;
};

/**
 * Shared by (app)/profile and (app)/profile-edit — both need the same
 * photo-if-present / initials-fallback avatar circle.
 */
export function Avatar({ displayName, photoUrl, size = 88 }: AvatarProps) {
  const t = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={displayName ?? ''}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.colors.accentSurfaceSoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: size * 0.34, fontWeight: '700' }} tone="accent">
          {initialsFor(displayName)}
        </Text>
      )}
    </View>
  );
}
