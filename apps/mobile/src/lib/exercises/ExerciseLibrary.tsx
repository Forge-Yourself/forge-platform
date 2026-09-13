import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  type Equipment,
  type MovementPattern,
  type MuscleGroup,
} from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { takeCustomExerciseCreated } from './customExerciseSignal';
import { useExerciseSearch } from './useExerciseSearch';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Button,
  EmptyState,
  Icon,
  ListRow,
  SearchField,
  SectionCard,
  Skeleton,
  Tag,
  Text,
} from '../../ui';

type FilterChip = {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

/**
 * One horizontally-scrolling row of filter chips — "no dropdown, no modal", per
 * the library annotation.
 *
 * Muscle, equipment and movement pattern used to sit in three stacked rows, which
 * cost ~120pt of a 390pt-wide phone before a single exercise was visible. Merged
 * into one row they are 48 chips long, so selected chips sort to the front: the
 * filters you have on are always the first thing in the row, and clearing them is
 * a tap away without scrolling to find them again.
 */
function FilterRow({ chips }: { chips: FilterChip[] }) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 7, paddingVertical: 2, paddingHorizontal: 1 }}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
          accessibilityState={{ selected: chip.selected }}
          onPress={chip.onPress}
          style={{
            minHeight: 38,
            paddingHorizontal: 13,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            borderRadius: theme.radius.pill,
            borderWidth: 1.5,
            borderColor: chip.selected ? theme.colors.accent : theme.colors.border,
            backgroundColor: chip.selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
          }}
        >
          <Text
            style={{
              fontSize: 12.5,
              fontWeight: '600',
              color: chip.selected ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary,
            }}
          >
            {chip.label}
          </Text>
          {chip.selected ? (
            <Icon name="close" size={12} color={theme.colors.onAccentSurfaceSoft} strokeWidth={2.4} />
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * The 44pt slot where the 12s demo loop will sit. `demo_video_url` is null across
 * the whole library until M10's licensed import, so this renders for every row —
 * which is the point: the row's geometry does not change on the day the videos
 * land.
 */
function ExerciseThumb({ hasVideo }: { hasVideo: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 9,
        backgroundColor: theme.colors.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name="play"
        size={15}
        color={hasVideo ? theme.colors.accentText : theme.colors.textMuted}
      />
    </View>
  );
}

export type ExerciseLibraryProps = {
  /**
   * The header chrome, handed the search box and filter row to place inside it.
   *
   * The library is reached two ways — as a tab, and as the builder's exercise
   * picker pushed over the top of an unsaved program — and the only thing that
   * differs between them is that chrome: a `ScreenHeader` title block on the tab,
   * a `NavHeader` with a Cancel control on the picker. Passing the controls back
   * out rather than branching on a `variant` prop keeps the search state, the
   * filter state and all five list states in one place, which is what stops the
   * two entry points drifting apart.
   */
  renderHeader: (controls: ReactNode) => ReactNode;
  /** A row was tapped. Both callers push the detail screen; only the params differ. */
  onSelect: (exerciseId: string) => void;
  /** The "+ Custom" action, and the CTA on the empty and no-match states. */
  onCreateCustom: () => void;
};

/**
 * The exercise library: search and filters that compose — type "press", tap
 * Barbell, tap Push, and the list narrows at each step. All five list states
 * (loading, empty, no-match, error, populated) render from this one component and
 * its `useExerciseSearch` hook.
 */
export function ExerciseLibrary({ renderHeader, onSelect, onCreateCustom }: ExerciseLibraryProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [pattern, setPattern] = useState<MovementPattern | null>(null);

  const { loading, error, items, total, isEmpty, isNoMatch, hasMore, loadMore, refetch } =
    useExerciseSearch(search, muscle, equipment, pattern);

  // Refetch only when library/custom.tsx says it inserted something. The library
  // tab stays mounted behind every screen pushed over it, so a plain
  // refetch-on-focus would fire constantly and reset pagination each time.
  useFocusEffect(
    useCallback(() => {
      if (takeCustomExerciseCreated()) void refetch();
    }, [refetch]),
  );

  const chips = useMemo<FilterChip[]>(() => {
    const all: FilterChip[] = [
      ...MUSCLE_GROUPS.map((v) => ({
        key: 'm:' + v,
        label: t('library.muscleLabels.' + v),
        selected: muscle === v,
        onPress: () => setMuscle((current) => (current === v ? null : v)),
      })),
      ...EQUIPMENT.map((v) => ({
        key: 'e:' + v,
        label: t('library.equipmentLabels.' + v),
        selected: equipment === v,
        onPress: () => setEquipment((current) => (current === v ? null : v)),
      })),
      ...MOVEMENT_PATTERNS.map((v) => ({
        key: 'p:' + v,
        label: t('library.patternLabels.' + v),
        selected: pattern === v,
        onPress: () => setPattern((current) => (current === v ? null : v)),
      })),
    ];
    return [...all.filter((c) => c.selected), ...all.filter((c) => !c.selected)];
  }, [t, muscle, equipment, pattern]);

  const controls = (
    <>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder={t('library.searchPlaceholder', { count: total })}
      />
      <FilterRow chips={chips} />
    </>
  );

  return (
    <>
      {renderHeader(controls)}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[6],
          gap: theme.space[3],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <>
            <Skeleton height={64} radius={theme.radius.lg} />
            <Skeleton height={64} radius={theme.radius.lg} />
            <Skeleton height={64} radius={theme.radius.lg} />
          </>
        ) : error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('library.offlineError.title')}
            body={t('library.offlineError.body')}
            actionLabel={t('library.offlineError.retry')}
            actionVariant="ghost"
            onAction={() => void refetch()}
          />
        ) : isEmpty ? (
          <EmptyState
            icon="dumbbell"
            title={t('library.empty.title')}
            body={t('library.empty.body')}
            actionLabel={t('library.empty.createButton')}
            onAction={onCreateCustom}
          />
        ) : isNoMatch ? (
          <EmptyState
            icon="search"
            title={t('library.noMatch.title', { query: search })}
            body={t('library.noMatch.body')}
            actionLabel={t('library.noMatch.createButton')}
            onAction={onCreateCustom}
          />
        ) : (
          <>
            <SectionCard>
              {items.map((item, index) => (
                <ListRow
                  key={item.id}
                  minHeight={64}
                  leading={<ExerciseThumb hasVideo={!!item.demo_video_url} />}
                  title={item.name}
                  subtitle={
                    t('library.muscleLabels.' + item.muscle_group) +
                    ' · ' +
                    t('library.equipmentLabels.' + item.equipment)
                  }
                  trailing={item.is_custom ? <Tag label={t('library.mineTag')} tone="accent" /> : undefined}
                  isLast={index === items.length - 1}
                  onPress={() => onSelect(item.id)}
                />
              ))}
            </SectionCard>
            {hasMore ? (
              <Button label={t('library.loadMore')} variant="ghost" onPress={() => void loadMore()} />
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
