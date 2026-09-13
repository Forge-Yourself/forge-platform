import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ExerciseLibrary } from '../../../lib/exercises/ExerciseLibrary';
import { useTheme } from '../../../theme/ThemeProvider';
import { Button, Screen, ScreenHeader } from '../../../ui';

/**
 * The Library tab: browsing, not picking.
 *
 * A row opens the detail screen with no program attached, so its "Add to program"
 * renders disabled with the line saying where it comes from. Adding to a program
 * happens in the builder's own picker — `(app)/programs/[id]/pick-exercise` — which
 * is a pushed screen rather than this tab. Routing the builder here instead pushed a
 * second copy of the whole tab navigator over the top of the unsaved program, and a
 * tab root has no back control, so the PT landed on this list with no way back to
 * the program they were writing.
 */
export default function LibraryIndex() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <ExerciseLibrary
        renderHeader={(controls) => (
          <ScreenHeader
            title={t('library.title')}
            action={
              <Button
                label={t('library.customAction')}
                variant="ghost"
                onPress={() => router.push('/(app)/library/custom')}
                style={{ borderRadius: theme.radius.pill, paddingHorizontal: theme.space[4] }}
              />
            }
          >
            {controls}
          </ScreenHeader>
        )}
        onSelect={(exerciseId) =>
          router.push({ pathname: '/(app)/library/[id]', params: { id: exerciseId } })
        }
        onCreateCustom={() => router.push('/(app)/library/custom')}
      />
    </Screen>
  );
}
