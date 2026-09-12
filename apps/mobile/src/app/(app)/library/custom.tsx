import {
  createCustomExerciseSchema,
  DIFFICULTIES,
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  type Difficulty,
  type Equipment,
  type MovementPattern,
  type MuscleGroup,
} from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { createCustomExercise } from '../../../lib/exercises/exerciseActions';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../../lib/forms/zodFieldErrors';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, FormScreen, Row, Text, TextField } from '../../../ui';

type Field = 'name' | 'muscleGroup' | 'equipment' | 'demoVideoUrl';

/** A wrapping single-select list of enum values, labelled through i18n. */
function EnumPicker<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
  allowClear = false,
}: {
  label: string;
  values: readonly T[];
  selected: T | null;
  onSelect: (value: T | null) => void;
  labelFor: (value: T) => string;
  allowClear?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {values.map((value) => {
          const isSelected = value === selected;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={labelFor(value)}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(isSelected && allowClear ? null : value)}
              style={{
                minHeight: 38,
                paddingHorizontal: theme.space[3],
                justifyContent: 'center',
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                backgroundColor: isSelected
                  ? theme.colors.accentSurfaceSoft
                  : theme.colors.surfaceRaised,
              }}
            >
              <Text
                variant="caption"
                style={{
                  fontWeight: '600',
                  color: isSelected ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary,
                }}
              >
                {labelFor(value)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Create a custom exercise. Only name, muscle group and equipment are
 * required — "this stays a 30-second job" per the annotation — and everything
 * else is optional, including the cues, which reuse the same add/remove shape
 * as the profile editor's certifications rather than inventing a second one.
 */
export default function CustomExercise() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [movementPattern, setMovementPattern] = useState<MovementPattern | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [cues, setCues] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});

  const { submitting, error, setError, run } = useAsyncSubmit();

  function buildInput() {
    const trimmedCues = cues.map((c) => c.trim()).filter((c) => c !== '');
    return {
      name: name.trim(),
      muscleGroup: muscleGroup ?? undefined,
      equipment: equipment ?? undefined,
      movementPattern: movementPattern ?? undefined,
      difficulty: difficulty ?? undefined,
      demoVideoUrl: videoUrl.trim() === '' ? undefined : videoUrl.trim(),
      coachingCues: trimmedCues.length > 0 ? trimmedCues : undefined,
    };
  }

  function validate() {
    const result = createCustomExerciseSchema.safeParse(buildInput());
    if (result.success) {
      setFieldErrors({});
      return result.data;
    }
    setFieldErrors(zodIssuesToFieldErrors<Field>(result.error.issues));
    return null;
  }

  async function handleSubmit() {
    setError(null);
    const input = validate();
    if (!input) return;

    await run(async () => {
      try {
        await createCustomExercise(input);
        router.back();
      } catch {
        setError(t('library.custom.error'));
      }
    });
  }

  return (
    <FormScreen
      footer={
        <Button
          label={t('library.custom.save')}
          size="lg"
          disabled={submitting}
          onPress={() => void handleSubmit()}
        />
      }
    >
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">{t('library.custom.title')}</Text>
          <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
        </Row>

        {error ? <Banner variant="danger" message={error} /> : null}

        <TextField
          label={t('library.custom.nameLabel')}
          placeholder={t('library.custom.namePlaceholder')}
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
        />

        <EnumPicker
          label={t('library.custom.muscleLabel')}
          values={MUSCLE_GROUPS}
          selected={muscleGroup}
          onSelect={setMuscleGroup}
          labelFor={(v) => t('library.muscleLabels.' + v)}
        />
        {fieldErrors.muscleGroup ? (
          <Text variant="caption" style={{ color: theme.colors.dangerAccent }}>
            {fieldErrors.muscleGroup}
          </Text>
        ) : null}

        <EnumPicker
          label={t('library.custom.equipmentLabel')}
          values={EQUIPMENT}
          selected={equipment}
          onSelect={setEquipment}
          labelFor={(v) => t('library.equipmentLabels.' + v)}
        />
        {fieldErrors.equipment ? (
          <Text variant="caption" style={{ color: theme.colors.dangerAccent }}>
            {fieldErrors.equipment}
          </Text>
        ) : null}

        <EnumPicker
          label={t('library.custom.patternLabel')}
          values={MOVEMENT_PATTERNS}
          selected={movementPattern}
          onSelect={setMovementPattern}
          labelFor={(v) => t('library.patternLabels.' + v)}
          allowClear
        />

        <EnumPicker
          label={t('library.custom.difficultyLabel')}
          values={DIFFICULTIES}
          selected={difficulty}
          onSelect={setDifficulty}
          labelFor={(v) => t('library.difficultyLabels.' + v)}
          allowClear
        />

        <TextField
          label={t('library.custom.videoLabel')}
          value={videoUrl}
          onChangeText={setVideoUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={fieldErrors.demoVideoUrl}
        />

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('library.custom.cuesLabel')}
          </Text>
          {cues.map((cue, index) => (
            <Row key={index} style={{ gap: theme.space[2] }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={String(index + 1)}
                  value={cue}
                  onChangeText={(value) =>
                    setCues((prev) => prev.map((c, i) => (i === index ? value : c)))
                  }
                />
              </View>
              <Button
                label={t('library.custom.removeCue')}
                variant="ghost"
                onPress={() => setCues((prev) => prev.filter((_, i) => i !== index))}
              />
            </Row>
          ))}
          {cues.length < 10 ? (
            <Button
              label={t('library.custom.addCue')}
              variant="ghost"
              onPress={() => setCues((prev) => [...prev, ''])}
            />
          ) : null}
        </View>
      </ScrollView>
    </FormScreen>
  );
}
