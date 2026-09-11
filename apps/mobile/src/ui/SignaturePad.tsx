import { useEffect, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Row } from './Row';

export type SignaturePadProps = {
  /** The accumulated signature as SVG path data (e.g. "M10 10 L12 11 ..."), or '' when empty. */
  value: string;
  onChange: (svgPath: string) => void;
  onClear: () => void;
  clearLabel?: string;
};

const PAD_HEIGHT = 150;

/**
 * The waiver signature pad *(DS gap — M2)*: a 150pt-tall box (per the
 * annotation, "a finger has room") capturing strokes via `PanResponder` —
 * `react-native-svg` and `PanResponder` are both already available, so this
 * needs no native module and stays Expo Go-compatible. Fully controlled: the
 * parent owns `value` and decides whether Submit is enabled from it (empty
 * string = nothing signed yet).
 *
 * Emits raw SVG path data, not a rasterized image — this is what lets
 * apps/web's pdf-lib call `drawSvgPath` directly on the value, with zero
 * image conversion anywhere in the pipeline.
 */
export function SignaturePad({ value, onChange, onClear, clearLabel = 'Clear' }: SignaturePadProps) {
  const t = useTheme();

  // PanResponder must be a stable singleton (recreating it every render breaks
  // gesture handling) but its callbacks need the LATEST `value` while dragging,
  // not the one closed over at creation. useState (not useRef) for the same
  // reason StepProgress/Skeleton use it elsewhere in this file: the
  // react-hooks/refs lint rule forbids reading/writing `.current` during
  // render, so the mutable "latest value" lives in a plain closure variable
  // instead, synced from an effect (which runs after render, not during it).
  const [handlers] = useState(() => {
    let latest = value;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        latest = `${latest}M${locationX.toFixed(1)} ${locationY.toFixed(1)} `;
        onChange(latest);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        latest = `${latest}L${locationX.toFixed(1)} ${locationY.toFixed(1)} `;
        onChange(latest);
      },
    });
    return {
      panHandlers: responder.panHandlers,
      setLatest: (v: string) => {
        latest = v;
      },
    };
  });

  useEffect(() => {
    handlers.setLatest(value);
  }, [value, handlers]);

  return (
    <View style={{ gap: t.space[2] }}>
      <View
        accessible
        accessibilityRole="none"
        accessibilityLabel="Signature area"
        {...handlers.panHandlers}
        style={{
          height: PAD_HEIGHT,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: t.colors.borderStrong,
          backgroundColor: t.colors.surfaceRaised,
          overflow: 'hidden',
        }}
      >
        <Svg width="100%" height="100%">
          {value ? (
            <Path d={value} stroke={t.colors.textPrimary} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          ) : null}
        </Svg>
      </View>
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button label={clearLabel} variant="ghost" onPress={onClear} disabled={!value} />
      </Row>
    </View>
  );
}
