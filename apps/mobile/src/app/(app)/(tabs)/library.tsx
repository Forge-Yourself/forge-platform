import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  type Equipment,
  type MovementPattern,
  type MuscleGroup,
} from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useExerciseSearch } from '../../../lib/exercises/useExerciseSearch';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  ListRow,
  Row,
  Screen,
  SectionCard,
  Skeleton,
  Text,
  TextField,
} from '../../../ui';

/**
 * Single-select horizontally-scrolling filter chips. Local to this screen
 * rather than a shared component: ChipRow is multi-select and wraps, and the
 * library annotation is explicit that these scroll sideways — "no dropdown,
 * no modal" — which is a different control, not a variant of that one.
 */
function FilterChips<T extends string>({
  values,
  selected,
  onSelect,
  labelFor,
}: {
  values: readonly T[];
  selected: T | null;
  onSelect: (value: T | null) => void;
  labelFor: (value: T) => string;
}) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: theme.space[2], paddingVertical: 2 }}
    >
      {values.map((value) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={labelFor(value)}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(isSelected ? null : value)}
            style={{
              minHeight: 38,
              paddingHorizontal: theme.space[3],
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              backgroundColor: isSelected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
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
    </ScrollView>
  );
}

/**
 * The exercise library: search and three filter rows that compose — type
 * "press", tap Barbell, tap Push, and the list narrows at each step. All five
 * list states (loading, empty, no-match, error, populated) render from this
 * one screen/hook pair.
 *
 * `returnTo` arrives when the builder opened this to pick an exercise; it is
 * forwarded to the detail screen, which is where the actual "Add to program"
 * handoff happens.
 */
export default function LibraryIndex() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ returnTo?: string; clientId?: string }>();

  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [pattern, setPattern] = useState<MovementPattern | null>(null);

  const { loading, error, items, total, isEmpty, isNoMatch, hasMore, loadMore, refetch } =
    useExerciseSearch(search, muscle, equipment, pattern);

  const openDetail = (id: string) =>
    router.push({
      pathname: '/(app)/library/[id]',
      params: { id, ...(params.returnTo ? { returnTo: params.returnTo } : {}), ...(params.clientId ? { clientId: params.clientId } : {}) },
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">{t('library.title')}</Text>
          <Button
            label={t('library.custom.title')}
            variant="ghost"
            onPress={() => router.push('/(app)/library/custom')}
          />
        </Row>

        <TextField
          label={t('library.searchPlaceholder', { count: total })}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={{ gap: theme.space[2] }}>
          <FilterChips
            values={MUSCLE_GROUPS}
            selected={muscle}
            onSelect={setMuscle}
            labelFor={(v) => t('library.muscleLabels.' + v)}
          />
          <FilterChips
            values={EQUIPMENT}
            selected={equipment}
            onSelect={setEquipment}
            labelFor={(v) => t('library.equipmentLabels.' + v)}
          />
          <FilterChips
            values={MOVEMENT_PATTERNS}
            selected={pattern}
            onSelect={setPattern}
            labelFor={(v) => t('library.patternLabels.' + v)}
          />
        </View>

        {loading ? (
          <SectionCard>
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </SectionCard>
        ) : error ? (
          <View style={{ gap: theme.space[3] }}>
            <Banner variant="danger" message={t('library.offlineError.body')} />
            <Button
              label={t('library.offlineError.retry')}
              variant="ghost"
              onPress={() => void refetch()}
            />
          </View>
        ) : isEmpty ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t('library.empty.title')}</Text>
            <Text tone="secondary">{t('library.empty.body')}</Text>
            <Button
              label={t('library.empty.createButton')}
              onPress={() => router.push('/(app)/library/custom')}
            />
          </View>
        ) : isNoMatch ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t('library.noMatch.title', { query: search })}</Text>
            <Text tone="secondary">{t('library.noMatch.body')}</Text>
            <Button
              label={t('library.noMatch.createButton')}
              onPress={() => router.push('/(app)/library/custom')}
            />
          </View>
        ) : (
          <View style={{ gap: theme.space[3] }}>
            <SectionCard>
              {items.map((item) => (
                <ListRow
                  key={item.id}
                  minHeight={64}
                  title={item.name}
                  subtitle={
                    t('library.muscleLabels.' + item.muscle_group) +
                    ' · ' +
                    t('library.equipmentLabels.' + item.equipment)
                  }
                  trailing={
                    item.is_custom ? (
                      <View
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: theme.radius.sm,
                          backgroundColor: theme.colors.accentSurfaceSoft,
                        }}
                      >
                        <Text
                          variant="caption"
                          style={{ fontWeight: '700', color: theme.colors.onAccentSurfaceSoft }}
                        >
                          {t('library.mineTag')}
                        </Text>
                      </View>
                    ) : undefined
                  }
                  onPress={() => openDetail(item.id)}
                />
              ))}
            </SectionCard>
            {hasMore ? (
              <Button label={t('common.continue')} variant="ghost" onPress={() => void loadMore()} />
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
