import { I18nManager, type ColorValue } from 'react-native';
import Svg, { Circle, Path, type SvgProps } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The app's icon set, drawn as SVG paths on a 24-unit grid.
 *
 * Before this, every icon in the app was a text glyph (◆ ◎ ▦ ▤ ‹ › ⚙ ✦) rendered
 * through <Text>. Those glyphs are font-dependent — they render at different
 * weights, baselines and widths on iOS and Android, several are missing from the
 * Android system font entirely, and none of them line up optically with a 1.8pt
 * stroke. react-native-svg is already a dependency (SignaturePad uses it), so the
 * set below costs no new package.
 *
 * Every path is stroke-only on a 24 grid with round caps and joins, so a single
 * `strokeWidth` keeps the whole set optically consistent at any size. Icons are
 * decorative by default: they sit inside a control that already carries the
 * accessibility label, so they render `aria-hidden` and never announce. (Not
 * `accessible={false}` — react-native-web forwards that to the DOM verbatim and
 * React logs it as an invalid attribute on every render.)
 */
export type IconName =
  | 'flame'
  | 'users'
  | 'calendar'
  | 'dumbbell'
  | 'search'
  | 'plus'
  | 'chevron'
  | 'chevronBack'
  | 'chevronDown'
  | 'close'
  | 'check'
  | 'alert'
  | 'warning'
  | 'sliders'
  | 'play'
  | 'sparkle'
  | 'mail'
  | 'copy'
  | 'share'
  | 'trash'
  | 'clock'
  | 'user'
  | 'shield'
  | 'document'
  | 'edit'
  | 'inbox'
  | 'backspace'
  | 'minus';

type Glyph = { d: string[]; circles?: [number, number, number][]; fill?: boolean };

const GLYPHS: Record<IconName, Glyph> = {
  // The brand mark's own silhouette — the ember in docs/Forge_Brand.html.
  flame: { d: ['M12 2.5c2.6 3.3 4.1 5.8 4.1 8.2a4.1 4.1 0 0 1-8.2 0c0-2.4 1.5-4.9 4.1-8.2z', 'M12 21.5c-2.4 0-4-1.4-4-3.3 0-1.3.8-2.4 2-3.6'] },
  users: {
    d: [
      'M15.5 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.1v1.4',
      'M16.8 4.8a3.5 3.5 0 0 1 0 6.6',
      'M18.4 14.7a3.6 3.6 0 0 1 2.6 3.4v1.4',
    ],
    circles: [[9.2, 8.1, 3.6]],
  },
  calendar: {
    d: [
      'M5.5 4.5h13A2.5 2.5 0 0 1 21 7v11.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V7a2.5 2.5 0 0 1 2.5-2.5z',
      'M8 2.5v4',
      'M16 2.5v4',
      'M3 9.8h18',
      'M7.2 13.5h4.2',
      'M7.2 17h8',
    ],
  },
  dumbbell: { d: ['M3.5 9.5v5', 'M6.8 6.8v10.4', 'M17.2 6.8v10.4', 'M20.5 9.5v5', 'M6.8 12h10.4'] },
  search: { d: ['M20.5 20.5 16.6 16.6'], circles: [[11, 11, 6.6]] },
  plus: { d: ['M12 5.2v13.6', 'M5.2 12h13.6'] },
  chevron: { d: ['m9.5 5 7 7-7 7'] },
  chevronBack: { d: ['m14.5 5-7 7 7 7'] },
  chevronDown: { d: ['m5 9.5 7 7 7-7'] },
  close: { d: ['M6 6l12 12', 'M18 6 6 18'] },
  check: { d: ['m4.5 12.6 4.9 4.9L19.5 7.4'] },
  alert: { d: ['M12 8.2v4.6', 'M12 16.4h.01'], circles: [[12, 12, 9]] },
  warning: {
    d: ['M12 3.2 22 19.6a1.6 1.6 0 0 1-1.4 2.4H3.4A1.6 1.6 0 0 1 2 19.6z', 'M12 9.4v4.4', 'M12 17.6h.01'],
  },
  sliders: { d: ['M3.5 7.5h7', 'M15.5 7.5h5', 'M3.5 16.5h5', 'M13.5 16.5h7'], circles: [[13, 7.5, 2.4], [10.5, 16.5, 2.4]] },
  play: { d: ['M8.5 5.4 19 12 8.5 18.6z'] },
  sparkle: {
    d: [
      'M11.5 3.2 13 8l4.8 1.5L13 11l-1.5 4.8L10 11l-4.8-1.5L10 8z',
      'M18 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
    ],
  },
  mail: { d: ['M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z', 'm2.8 7.6 9.2 6 9.2-6'] },
  copy: { d: ['M10 8.5h8.5A1.5 1.5 0 0 1 20 10v9a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 19v-9A1.5 1.5 0 0 1 10 8.5z', 'M5.5 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5'] },
  share: { d: ['M12 15.5V3.6', 'm8 7.4 4-3.9 4 3.9', 'M5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6'] },
  trash: { d: ['M4 6.8h16', 'M9.5 6.8v-2h5v2', 'm6.6 6.8 1 12.2h8.8l1-12.2'] },
  clock: { d: ['M12 7v5.3l3.4 2'], circles: [[12, 12, 8.6]] },
  user: { d: ['M4.6 20.2a7.4 7.4 0 0 1 14.8 0'], circles: [[12, 8, 4]] },
  shield: { d: ['M12 3 19.4 5.9v5.9c0 4.4-3 7.4-7.4 8.9-4.4-1.5-7.4-4.5-7.4-8.9V5.9z', 'm9 12 2.2 2.2L15.4 10'] },
  document: { d: ['M6.5 3h6.6L18 7.9V21H6.5z', 'M13 3v5h5'] },
  edit: { d: ['M4 20.2h4.2L19 9.4a2.2 2.2 0 0 0-3.1-3.1L5 17z', 'm14.6 7.6 3.1 3.1'] },
  backspace: {
    d: [
      'M8.6 5.2h10A2.4 2.4 0 0 1 21 7.6v8.8a2.4 2.4 0 0 1-2.4 2.4h-10L2.6 12z',
      'm11.5 9.5 5 5',
      'm16.5 9.5-5 5',
    ],
  },
  minus: { d: ['M5.2 12h13.6'] },
  inbox: { d: ['M3.5 12.5h4l1.6 2.8h5.8l1.6-2.8h4', 'M6.4 4.5h11.2l2.9 8v5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-5z'] },
};

/** Glyphs whose meaning is directional and must mirror in an RTL layout. */
const MIRRORED = new Set<IconName>(['chevron', 'chevronBack', 'play', 'share']);

export type IconProps = Omit<SvgProps, 'width' | 'height'> & {
  name: IconName;
  size?: number;
  /**
   * Defaults to the current text colour role. Typed as ColorValue, not string, so
   * the navigator-supplied `color` a tabBarIcon receives passes straight through.
   */
  color?: ColorValue;
  strokeWidth?: number;
};

export function Icon({ name, size = 20, color, strokeWidth = 1.8, ...rest }: IconProps) {
  const t = useTheme();
  const stroke = color ?? t.colors.textPrimary;
  const glyph = GLYPHS[name];
  const mirror = I18nManager.isRTL && MIRRORED.has(name);

  return (
    <Svg
      {...rest}
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={[mirror ? { transform: [{ scaleX: -1 }] } : null, rest.style]}
    >
      {glyph.d.map((d) => (
        <Path
          key={d}
          d={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={name === 'play' ? stroke : 'none'}
        />
      ))}
      {(glyph.circles ?? []).map(([cx, cy, r]) => (
        <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={strokeWidth} fill="none" />
      ))}
    </Svg>
  );
}
