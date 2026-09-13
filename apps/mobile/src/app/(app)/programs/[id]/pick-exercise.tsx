import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ExerciseLibrary } from '../../../../lib/exercises/ExerciseLibrary';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Button, NavHeader, Screen } from '../../../../ui';

/**
 * The builder's exercise picker — the same library as the tab, pushed as a plain
 * stack screen over the program being written.
 *
 * "+ Add exercise" used to route to `(app)/(tabs)/library`. That is a screen inside
 * the Tabs navigator, and expo-router resolves a push to it as a push of the whole
 * `(tabs)` route onto the `(app)` stack — so a second tab navigator mounted on top
 * of the builder, and the library list it landed on is a TAB ROOT with no back
 * control. Picking an exercise popped the detail screen and left the PT stranded on
 * that list, with the program they had been writing buried two frames down and no
 * affordance pointing back at it.
 *
 * Owning the picker as its own route under `programs/[id]/` fixes that at the
 * source: Cancel and the Android back button both pop straight to the builder, and
 * the detail screen knows which program to return to because `programId` rides
 * along with it.
 */
export default function PickExercise() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; clientId?: string }>();

  return (
    <Screen padded={false}>
      <ExerciseLibrary
        renderHeader={(controls) => (
          <>
            <NavHeader
              title={t('builder.addExercise')}
              leading={
                <Button label={t('common.cancel')} variant="link" onPress={() => router.back()} />
              }
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
        onSelect={(exerciseId) =>
          router.push({
            pathname: '/(app)/library/[id]',
            params: {
              id: exerciseId,
              programId: params.id,
              // Drives the detail screen's "this client's history" block. Absent for
              // a template, which has no client.
              ...(params.clientId ? { clientId: params.clientId } : {}),
            },
          })
        }
        onCreateCustom={() => router.push('/(app)/library/custom')}
      />
    </Screen>
  );
}
