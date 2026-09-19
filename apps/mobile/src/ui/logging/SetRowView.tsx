import { palette } from '@forge/shared';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../Icon';
import { Tag } from '../Tag';
import { Text } from '../Text';

export type CellKey = 'weight' | 'reps' | 'rpe';

/**
 * Prototype `session` set row: set number, three mono cells, check. One row per
 * set, 44pt targets. `done` rows open the edit sheet from the check; the
 * `current` row's cells open the keypad and its check logs the set; `planned`
 * rows show the prescription, muted and inert. The artboard's mic button is
 * voice logging, M4d.
 */
export function SetRowView({
  n,
  weight,
  reps,
  rpe,
  labels,
  state,
  error = false,
  coach = null,
  onCell,
  cellA11y,
  a11yCheck,
  onCheck,
}: {
  n: string;
  weight: string;
  reps: string;
  rpe: string;
  labels: Record<CellKey, string>;
  state: 'done' | 'current' | 'planned';
  error?: boolean;
  coach?: string | null;
  onCell?: (key: CellKey) => void;
  cellA11y?: Record<CellKey, string>;
  a11yCheck?: string;
  onCheck?: () => void;
}) {
  const theme = useTheme();
  const isCurrent = state === 'current';
  const valueColor = state === 'planned' ? theme.colors.textMuted : theme.colors.textPrimary;
  const cells: { key: CellKey; value: string }[] = [
    { key: 'weight', value: weight },
    { key: 'reps', value: reps },
    { key: 'rpe', value: rpe },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: error ? theme.colors.dangerAccent : isCurrent ? theme.colors.accent : theme.colors.border,
        backgroundColor: isCurrent ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
      }}
    >
      <View style={{ width: 20 }}>
        <Text
          numeric
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: isCurrent ? theme.colors.onAccentSurfaceSoft : theme.colors.textMuted,
          }}
        >
          {n}
        </Text>
      </View>
      {cells.map((c) => {
        const body = (
          <>
            <Text numeric numberOfLines={1} style={{ fontSize: 17, fontWeight: '700', lineHeight: 19, color: valueColor }}>
              {c.value}
            </Text>
            <Text style={{ fontSize: 8.5, fontWeight: '600', letterSpacing: 1, color: theme.colors.textMuted, marginTop: 2 }}>
              {labels[c.key]}
            </Text>
          </>
        );
        return isCurrent && onCell ? (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${cellA11y?.[c.key] ?? labels[c.key]}: ${c.value}`}
            onPress={() => onCell(c.key)}
            style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}
          >
            {body}
          </Pressable>
        ) : (
          <View key={c.key} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}>
            {body}
          </View>
        );
      })}
      {coach ? <Tag label={coach} tone="neutral" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yCheck}
        disabled={!onCheck}
        onPress={onCheck}
        style={{
          width: 44,
          height: 44,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: state === 'done' ? palette.success : isCurrent ? theme.colors.accent : theme.colors.border,
          backgroundColor: state === 'done' ? palette.success : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isCurrent && !onCheck ? 0.5 : 1,
        }}
      >
        {state === 'done' ? (
          <Icon name="check" size={18} color={palette.white} strokeWidth={2.6} />
        ) : isCurrent ? (
          <Icon name="check" size={18} color={theme.colors.accentText} strokeWidth={2.2} />
        ) : null}
      </Pressable>
    </View>
  );
}
