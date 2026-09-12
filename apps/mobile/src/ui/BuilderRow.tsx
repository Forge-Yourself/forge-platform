import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type BuilderCellKey = 'sets' | 'reps' | 'rpe' | 'tempo';

export type BuilderCell = {
  key: BuilderCellKey;
  /** Already-translated column label — SETS / REPS / RPE / TEMPO. */
  label: string;
  /** Already-formatted value, or an empty string for a cell not yet filled. */
  value: string;
};

export type BuilderRowProps = {
  /** Superset slot marker: A1, A2, B1… Derived by the builder from block + index. */
  slot: string;
  name: string;
  cells: BuilderCell[];
  activeCellKey?: BuilderCellKey | null;
  /**
   * Omit to render the row read-only. That is not a disabled state — it is the
   * client's own view of their program (apps/mobile/src/app/(app)/my-program.tsx),
   * where the numbers must read exactly as the PT typed them but nothing is
   * tappable. Cells become plain Views rather than inert Pressables so a
   * screen reader never announces a button that does nothing.
   */
  onCellPress?: (key: BuilderCellKey) => void;
  /** Tapping the name swaps the exercise. */
  onPress?: () => void;
  onRemove?: () => void;
  /** Already-translated accessibility label for the remove control. */
  removeLabel?: string;
};

const CELL_GAP = 6;
const CELL_MIN_WIDTH = 64;

/**
 * One prescribed exercise in the builder: the name on top, a four-cell numeric
 * strip beneath it.
 *
 * The four cells fit a 390pt phone with room to spare, and the arithmetic is
 * the reason this component exists rather than the cells living on the name
 * row:
 *
 *   390 − 32 (screen gutter) − 24 (block card padding) − 18 (three 6pt gaps)
 *     = 316 ÷ 4 = 79pt per cell, at a 44pt height floor.
 *
 * So: do not move these cells onto the name row, and do not shrink the type to
 * make them fit something else — at 79pt wide and 44pt tall they already clear
 * the touch-target floor on the narrowest device we support.
 */
export function BuilderRow({
  slot,
  name,
  cells,
  activeCellKey = null,
  onCellPress,
  onPress,
  onRemove,
  removeLabel,
}: BuilderRowProps) {
  const t = useTheme();
  const readOnly = onCellPress === undefined;

  return (
    <View style={{ paddingVertical: t.space[3], gap: t.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[2] }}>
        <View
          style={{
            minWidth: 26,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.surfaceSunken,
            alignItems: 'center',
          }}
        >
          <Text numeric tone="secondary" style={{ fontSize: 11, fontWeight: '700', lineHeight: 16 }}>
            {slot}
          </Text>
        </View>

        {onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={name}
            onPress={onPress}
            style={{ flex: 1, minHeight: t.touchTarget, justifyContent: 'center' }}
          >
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
              {name}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1, minHeight: readOnly ? undefined : t.touchTarget, justifyContent: 'center' }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
              {name}
            </Text>
          </View>
        )}

        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={removeLabel ?? 'Remove'}
            onPress={onRemove}
            style={{
              width: t.touchTarget,
              height: t.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text tone="muted" style={{ fontSize: 18, lineHeight: 22 }}>
              ×
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: CELL_GAP }}>
        {cells.map((cell) => {
          const active = cell.key === activeCellKey;
          const body = (
            <>
              <Text
                tone="muted"
                style={{
                  fontSize: 9.5,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  lineHeight: 13,
                  textTransform: 'uppercase',
                }}
              >
                {cell.label}
              </Text>
              <Text
                numeric
                tone={active ? 'accent' : 'primary'}
                style={{ fontSize: 17, fontWeight: '700', lineHeight: 22 }}
              >
                {cell.value === '' ? '—' : cell.value}
              </Text>
            </>
          );

          const cellStyle = {
            flex: 1,
            minWidth: CELL_MIN_WIDTH,
            minHeight: t.touchTarget,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
            borderRadius: t.radius.md,
            paddingVertical: 4,
            backgroundColor: active ? t.colors.accentSurfaceSoft : t.colors.surfaceSunken,
            borderWidth: active ? 1.5 : 1,
            borderColor: active ? t.colors.accent : t.colors.border,
          };

          if (readOnly) {
            return (
              <View key={cell.key} style={cellStyle}>
                {body}
              </View>
            );
          }

          return (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={cell.label + ', ' + (cell.value === '' ? 'not set' : cell.value)}
              accessibilityState={{ selected: active }}
              onPress={() => onCellPress(cell.key)}
              style={cellStyle}
            >
              {body}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
