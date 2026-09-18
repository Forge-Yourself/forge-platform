import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ExerciseLibrary } from '../../../../lib/exercises/ExerciseLibrary';
import { setPickedExercise } from '../../../../lib/programs/exercisePicker';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Button, NavHeader, Screen } from '../../../../ui';

/**
 * The session's own pushed picker. The pick goes through the same handoff
 * singleton the builder uses (lib/programs/exercisePicker.ts) and is taken on
 * focus by the session screen; the name is resolved there.
 *
 * Unlike the builder's picker this one selects straight off the list rather
 * than routing through the library detail screen: mid-session the PT already
 * knows the movement, and a second screen between "+ Add exercise" and the
 * focus card costs taps the gym floor does not have.
 */
export default function SessionPickExercise() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();

  const backToSession = () =>
    router.dismissTo({ pathname: '/(app)/sessions/[id]', params: { id: params.id } });

  return (
    <Screen padded={false}>
      <ExerciseLibrary
        renderHeader={(controls) => (
          <>
            <NavHeader
              title={t('logging.session.addExercise')}
              leading={
                <Button
                  label={t('common.back')}
                  variant="link"
                  icon="chevronBack"
                  onPress={backToSession}
                />
              }
              divider
            />
            <View
              style={{
                paddingHorizontal: theme.space[5],
                paddingTop: theme.space[3],
                paddingBottom: theme.space[3],
                gap: theme.space[3],
              }}
            >
              {controls}
            </View>
          </>
        )}
        onSelect={(exerciseId) => {
          // The name is left empty on purpose: the session screen resolves it
          // through useSession's ensureNames, so the rail never shows a name
          // the library happened to have cached under a different locale.
          setPickedExercise({ id: exerciseId, name: '' });
          backToSession();
        }}
        onCreateCustom={() => router.push('/(app)/library/custom')}
      />
    </Screen>
  );
}
