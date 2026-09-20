import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import type { PtFloor } from '../../lib/logging/usePtFloor';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../Text';
import { FloorList } from './FloorRail';

/** The multi-client switcher on a phone (design brief M4): the rail's list in a bottom sheet.
 * `floor` comes from the caller's own `usePtFloor` call — this sheet never queries on its own. */
export function SwitcherSheet({
  visible,
  currentSessionId,
  floor,
  onClose,
}: {
  visible: boolean;
  currentSessionId: string;
  floor: PtFloor;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View
          style={{
            maxHeight: '80%',
            paddingBottom: theme.space[6],
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
          }}
        >
          <Text variant="h3" accessibilityRole="header" style={{ padding: theme.space[4], paddingBottom: 0 }}>
            {t('logging.console.switcher')}
          </Text>
          <ScrollView>
            {/* Modal keeps its children mounted even while hidden, so gate the
                list (and its rows' per-second tick) on `visible` ourselves —
                a solo PT's never-opened switcher should run nothing. */}
            {visible ? (
              <FloorList
                currentSessionId={currentSessionId}
                floor={floor}
                onPick={(id) => {
                  onClose();
                  if (id !== currentSessionId) router.setParams({ id });
                }}
              />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
