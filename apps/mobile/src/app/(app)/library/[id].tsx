import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useExerciseDetail } from '../../../lib/exercises/useExerciseDetail';
import { setPickedExercise } from '../../../lib/programs/exercisePicker';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, Card, Screen, Skeleton, Text } from '../../../ui';

/**
 * A striped placeholder standing in for the 12s demo loop. Drawn from rotated
 * Views rather than an image asset so it costs nothing and themes itself —
 * every exercise renders this at M3, since demo_video_url is null across the
 * whole library until the licensed import lands.
 */
function VideoPlaceholder({ caption }: { caption: string }) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={caption}
      style={{
        width: '100%',
        aspectRatio: 16 / 9,
        maxWidth: '100%',
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surfaceSunken,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: 14 }, (_, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -80,
            left: i * 34 - 60,
            width: 10,
            height: 400,
            backgroundColor: theme.colors.border,
            opacity: 0.5,
            transform: [{ rotate: '20deg' }],
          }}
        />
      ))}
      <Text variant="caption" tone="muted">
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
 * "Add to program" only does something when the builder opened this screen
 * (params.returnTo); otherwise it renders disabled with a line saying where
 * it comes from, rather than silently doing nothing.
 */
export default function ExerciseDetail() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; returnTo?: string; clientId?: string }>();
  const { loading, error, exercise, history } = useExerciseDetail(params.id, params.clientId);

  const addToProgram = () => {
    if (!params.returnTo || !exercise) return;
    // The builder consumes this on focus and drops it into the block it was
    // editing — the library never writes to a program itself.
    setPickedExercise({ id: exercise.id, name: exercise.name });
    router.back();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />

        {loading ? (
          <View style={{ gap: theme.space[3] }}>
            <Skeleton height={180} />
            <Skeleton height={24} />
            <Skeleton height={64} />
          </View>
        ) : error || !exercise ? (
          <Banner variant="danger" message={t('library.offlineError.body')} />
        ) : (
          <>
            <Text variant="h1">{exercise.name}</Text>
            <Text tone="secondary">
              {t('library.muscleLabels.' + exercise.muscle_group)}
              {' · '}
              {t('library.equipmentLabels.' + exercise.equipment)}
              {' · '}
              {t('library.patternLabels.' + exercise.movement_pattern)}
            </Text>

            <VideoPlaceholder caption={t('library.detail.videoPlaceholder')} />

            {exercise.instructions ? <Text>{exercise.instructions}</Text> : null}

            <Card>
              <Text variant="label" tone="muted">
                {t('library.detail.cuesTitle')}
              </Text>
              {exercise.coaching_cues.length === 0 ? (
                <Text tone="secondary">{t('library.detail.noCues')}</Text>
              ) : (
                exercise.coaching_cues.map((cue, i) => (
                  <View
                    key={cue}
                    style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}
                  >
                    <Text numeric tone="muted" style={{ fontSize: 15, lineHeight: 22 }}>
                      {i + 1}
                    </Text>
                    <Text style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{cue}</Text>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <Text variant="label" tone="muted">
                {t('library.detail.historyTitle')}
              </Text>
              {history.length === 0 ? (
                <Text tone="secondary">{t('library.detail.historyEmpty')}</Text>
              ) : (
                history.map((entry) => (
                  <Text key={entry.performedAt} numeric>
                    {entry.performedAt}
                  </Text>
                ))
              )}
            </Card>

            <View style={{ gap: theme.space[2] }}>
              <Button
                label={t('library.detail.addToProgram')}
                size="lg"
                disabled={!params.returnTo}
                onPress={addToProgram}
              />
              {!params.returnTo ? (
                <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                  {t('library.detail.addFromBuilderHint')}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
