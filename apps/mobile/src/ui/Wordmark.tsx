import { palette } from '@forge/shared';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type WordmarkProps = {
  /**
   * `type`   — FORGE as letterspaced lettering, no mark. What the auth artboards
   *            draw: on a screen with nothing else on it, the name IS the heading.
   * `lockup` — mark tile + lettering, the brand doc's primary lockup.
   * `mark`   — the ember tile alone, for a compact header.
   */
  variant?: 'type' | 'lockup' | 'mark';
  /**
   * For `lockup`/`mark`, the tile's height (the lettering scales from it).
   * For `type`, the lettering's own font size.
   */
  size?: number;
};

/**
 * The Forge lockup: the ember in a charcoal tile, then FORGE at 900 with the
 * brand's wide tracking (docs/Forge_Brand.html).
 *
 * The ember is drawn rather than shipped as an asset so it costs nothing and stays
 * crisp at any size.
 *
 * The tile and the flame are fixed brand colours, not theme roles — a logo does
 * not restyle itself per scheme. Only the lettering follows the text role.
 */
export function Wordmark({ variant = 'lockup', size = 40 }: WordmarkProps) {
  const t = useTheme();

  // 900 weight at 7/34 of the size in tracking is the brand doc's wordmark spec
  // (docs/Forge_Brand.html) and what the sign-in artboard sets literally.
  if (variant === 'type') {
    return (
      <Text
        accessibilityRole="header"
        style={{
          fontSize: size,
          fontWeight: '900',
          letterSpacing: size * 0.2,
          color: t.colors.textPrimary,
        }}
      >
        FORGE
      </Text>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Forge"
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.32 }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: palette.charcoal800,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={size * 0.52} height={size * 0.62} viewBox="0 0 26 32">
          <Defs>
            <LinearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={palette.ember300} />
              <Stop offset="1" stopColor={palette.ember600} />
            </LinearGradient>
          </Defs>
          <Path
            d="M13 1c6.6 7.2 10.4 12.5 10.4 17.6a10.4 10.4 0 0 1-20.8 0C2.6 13.5 6.4 8.2 13 1z"
            fill="url(#ember)"
          />
          <Path
            d="M13 12c2.9 3.6 4.6 6.1 4.6 8.5a4.6 4.6 0 0 1-9.2 0c0-2.4 1.7-4.9 4.6-8.5z"
            fill={palette.cream100}
            opacity={0.9}
          />
        </Svg>
      </View>

      {variant === 'mark' ? null : (
        <Text
          style={{
            fontSize: size * 0.42,
            fontWeight: '900',
            letterSpacing: size * 0.16,
            color: t.colors.textPrimary,
          }}
        >
          FORGE
        </Text>
      )}
    </View>
  );
}
