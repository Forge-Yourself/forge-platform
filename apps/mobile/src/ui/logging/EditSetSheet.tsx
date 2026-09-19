import { displayToKg, kgToDisplay, LOGGING_LIMITS, unitLabel, type UnitSystem } from '@forge/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { Draft } from '../../lib/logging/useSessionController';
import type { SetRow } from '../../lib/logging/sessionRpc';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { Row } from '../Row';
import { SegmentedPill } from '../SegmentedPill';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { Toggle } from '../Toggle';

export function EditSetSheet({
  set,
  unit,
  onSave,
  onDelete,
  onDismiss,
}: {
  set: SetRow;
  unit: UnitSystem;
  onSave: (values: Draft) => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [values, setValues] = useState<Draft>({
    weightKg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    notes: set.notes ?? '',
    isWarmup: set.is_warmup,
  });
  const shown = values.weightKg === null ? '' : String(kgToDisplay(values.weightKg, unit));
  const rpeItems = [
    { label: t('logging.session.rpeSkip'), value: '' },
    ...[6, 7, 8, 9, 10].map((n) => ({ label: String(n), value: String(n) })),
  ];
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={onDismiss}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      />
      <View
        style={{
          padding: theme.space[5],
          gap: theme.space[3],
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
        }}
      >
        <Text variant="h3">{t('logging.session.editSet')}</Text>
        <Row style={{ gap: theme.space[3], alignItems: 'flex-start' }}>
          {/* TextField is Omit<TextInputProps, 'style'> — the flex lives on a wrapper. */}
          <View style={{ flex: 1 }}>
            <TextField
              label={t('logging.session.weight') + ' · ' + unitLabel(unit)}
              keyboardType="decimal-pad"
              value={shown}
              onChangeText={(v) =>
                setValues((d) => ({ ...d, weightKg: v === '' ? null : displayToKg(Number(v), unit) }))
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('logging.session.reps')}
              keyboardType="number-pad"
              value={values.reps === null ? '' : String(values.reps)}
              onChangeText={(v) =>
                setValues((d) => ({ ...d, reps: v === '' ? null : Math.round(Number(v)) }))
              }
            />
          </View>
        </Row>
        <SegmentedPill
          items={rpeItems}
          selected={values.rpe === null ? '' : String(values.rpe)}
          onChange={(v) => setValues((d) => ({ ...d, rpe: v === '' ? null : Number(v) }))}
        />
        <Toggle
          label={t('logging.session.warmup')}
          value={values.isWarmup}
          onValueChange={(v) => setValues((d) => ({ ...d, isWarmup: v }))}
        />
        <TextField
          label={t('logging.session.note')}
          value={values.notes}
          onChangeText={(v) => setValues((d) => ({ ...d, notes: v }))}
          maxLength={LOGGING_LIMITS.set_notes}
        />
        <Button label={t('common.save')} size="lg" onPress={() => onSave(values)} />
        <Button
          label={t('logging.session.deleteSet')}
          variant="ghost"
          tone="danger"
          onPress={onDelete}
        />
        <Button label={t('common.cancel')} variant="link" onPress={onDismiss} />
      </View>
    </View>
  );
}
