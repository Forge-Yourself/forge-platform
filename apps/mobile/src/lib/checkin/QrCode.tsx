import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * A QR code as one SVG path: dark modules on white, always, in every theme —
 * gym light is dim and a phone camera needs the contrast (design note on 05).
 * ECC level M survives a cracked screen or a glare stripe; a 4-module quiet
 * zone is the spec minimum readers rely on.
 */
export function QrCode({ value, size, label }: { value: string; size: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { d: path, n: count + 8 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} accessibilityLabel={label} accessible={!!label}>
      <Rect x={0} y={0} width={n} height={n} fill="#FFFFFF" />
      <Path d={d} fill="#0F131C" />
    </Svg>
  );
}
