import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useExerciseDetail } from '../../../lib/exercises/useExerciseDetail';
import { setPickedExercise } from '../../../lib/programs/exercisePicker';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  FooterBar,
  Icon,
  NavHeader,
  Screen,
  SectionLabel,
  Skeleton,
  Tag,
  Text,
} from '../../../ui';

/**
 * The slot the 12s demo loop drops into.
 *
 * It is drawn — a 135° hatch of rotated Views behind an ember play disc — rather
 * than shipped as an image, so it costs no asset and themes itself. Every exercise
 * renders it at M3: `demo_video_url` is null across the whole library until M10's
 * licensed import.
 *
 * The mono caption states what belongs here rather than apologising for what is
 * missing; the previous version was a grey box with "Demo video coming soon" as
 * its only content, which reads as an unfinished screen rather than a placeholder.
 */
function VideoSlot({ caption }: { caption: string }) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={caption}
      style={{
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surfaceSunken,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
      }}
    >
      {Array.from({ length: 16 }, (_, i) => (
        <View
          key={i}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: -120,
            left: i * 32 - 80,
            width: 8,
            height: 500,
            backgroundColor: theme.colors.border,
            opacity: 0.45,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ))}
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: theme.colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 3,
        }}
      >
        <Icon name="play" size={20} color={theme.colors.onAccent} />
      </View>
      <Text
        numeric
        style={{ fontSize: 10.5, letterSpacing: 1, color: theme.colors.textMuted }}
      >
        {caption}
      </Text>
    </View>
  );
}

/**
 * Exercise detail. The cues are numbered rows readable at arm's length while
 * coaching, and the client's own history sits at the bottom because it is
 * what decides today's load — empty until M4 adds logging, with its own
 * state rather than a crash or a blank.
 *
 * "Add to program" only does something when the builder's picker opened this
 * screen (params.programId); otherwise it renders disabled with a line saying
 * where it comes from, rather than silently doing nothing.
 */
export default function ExerciseDetail() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; programId?: string; clientId?: string }>();
  const { loading, error, exercise, history } = useExerciseDetail(params.id, params.clientId);
  const programId = params.programId;

  const addToProgram = () => {
    if (!programId || !exercise) return;
    // The builder consumes this on focus and drops it into the block it was
    // editing — the library never writes to a program itself.
    setPickedExercise({ id: exercise.id, name: exercise.name });
    // dismissTo, not back(): the picker sits between this screen and the builder,
    // and a single pop would leave the PT on the picker with the chosen exercise
    // nowhere in sight. Popping to the builder by name keeps its route key, so the
    // unsaved draft it is holding survives the round trip.
    router.dismissTo({ pathname: '/(app)/programs/[id]/builder', params: { id: programId } });
  };

  const back = (
    <Button label={t('library.title')} icon="chevronBack" variant="link" onPress={() => router.back()} />
  );

  if (loading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Skeleton height={200} radius={theme.radius.lg} />
          <Skeleton height={26} width="70%" />
          <Skeleton height={64} radius={theme.radius.md} />
        </View>
      </Screen>
    );
  }

  if (error || !exercise) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4] }}>
          <Banner variant="danger" message={t('library.offlineError.body')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader leading={back} divider={false} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[5],
          gap: theme.space[4],
        }}
      >
        <VideoSlot caption={t('library.detail.videoPlaceholder')} />

        <View style={{ gap: theme.space[3] }}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 23, fontWeight: '800', letterSpacing: -0.4 }}
          >
            {exercise.name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Tag label={t('library.muscleLabels.' + exercise.muscle_group)} />
            <Tag label={t('library.patternLabels.' + exercise.movement_pattern)} />
            <Tag label={t('library.equipmentLabels.' + exercise.equipment)} />
            {exercise.is_custom ? <Tag label={t('library.mineTag')} tone="accent" /> : null}
          </View>
        </View>

        {exercise.instructions ? (
          <Text tone="secondary" style={{ fontSize: 13.5, lineHeight: 21 }}>
            {exercise.instructions}
          </Text>
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('library.detail.cuesTitle')}</SectionLabel>
          {exercise.coaching_cues.length === 0 ? (
            <Text tone="secondary" style={{ paddingHorizontal: 4 }}>
              {t('library.detail.noCues')}
            </Text>
          ) : (
            exercise.coaching_cues.map((cue, i) => (
              <View
                key={cue}
                style={{
                  flexDirection: 'row',
                  gap: theme.space[3],
                  alignItems: 'flex-start',
                  padding: theme.space[3] + 2,
                  borderRadius: theme.radius.lg - 2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceRaised,
                }}
              >
                <Text numeric style={{ fontSize: 12, fontWeight: '700', color: theme.colors.accentText }}>
                  {i + 1}
                </Text>
                <Text tone="secondary" style={{ flex: 1, fontSize: 13.5, lineHeight: 20 }}>
                  {cue}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('library.detail.historyTitle')}</SectionLabel>
          <View
            style={{
              padding: theme.space[4],
              borderRadius: theme.radius.lg - 2,
              backgroundColor: theme.colors.surfaceSunken,
              gap: 4,
            }}
          >
            {history.length === 0 ? (
              <Text tone="secondary" style={{ fontSize: 13 }}>
                {t('library.detail.historyEmpty')}
              </Text>
            ) : (
              history.map((entry) => (
                <Text key={entry.performedAt} numeric style={{ fontSize: 15, fontWeight: '700' }}>
                  {entry.performedAt}
                </Text>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <FooterBar>
        <Button
          label={t('library.detail.addToProgram')}
          size="lg"
          disabled={!programId}
          onPress={addToProgram}
        />
        {!programId ? (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {t('library.detail.addFromBuilderHint')}
          </Text>
        ) : null}
      </FooterBar>
    </Screen>
  );
}
