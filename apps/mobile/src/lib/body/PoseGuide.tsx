import type { PhotoPose } from '@forge/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

const FRONT =
  'M150 118 C120 118 104 130 100 150 L84 260 C82 280 96 284 100 266 L112 190 L114 300 L104 520 C104 540 128 540 130 520 L146 330 L154 330 L170 520 C172 540 196 540 196 520 L186 300 L188 190 L200 266 C204 284 218 280 216 260 L200 150 C196 130 180 118 150 118 Z';
const SIDE =
  'M150 118 C132 118 124 132 124 152 L122 220 C120 260 126 290 130 310 L126 520 C126 540 150 540 150 520 L160 330 C168 300 176 262 174 220 L172 152 C172 132 166 118 150 118 Z';

/**
 * The on-screen pose guide (EP-06). A dashed outline the subject stands
 * inside, so photos weeks apart line up. Front and back share an outline;
 * side right is side left mirrored. Purely decorative: hidden from
 * accessibility, never intercepts touches.
 */
export function PoseGuide({ pose }: { pose: PhotoPose }) {
  if (pose === 'custom') return null;
  const side = pose === 'side_left' || pose === 'side_right';
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
      {/* Explicit 100% width AND height: with only a style, react-native-svg on web
          sizes the element from the viewBox's aspect and overflows the preview,
          which ignores `meet` and cut the legs off (M4c walk). */}
      <Svg width="100%" height="100%" viewBox="0 0 300 560" preserveAspectRatio="xMidYMid meet">
        <G
          transform={pose === 'side_right' ? 'translate(300,0) scale(-1,1)' : undefined}
          stroke="#FFFFFF"
          strokeOpacity={0.85}
          strokeWidth={2.5}
          strokeDasharray="8 6"
          fill="none"
        >
          <Circle cx={side ? 154 : 150} cy={80} r={36} />
          <Path d={side ? SIDE : FRONT} />
        </G>
      </Svg>
    </View>
  );
}
