import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /** Screen-reader label for the scrim, which dismisses. */
  dismissLabel: string;
};

/** The design's sheets (late cancel, no-show, edit scope, range editor). Tapping the scrim dismisses. */
export function BottomSheet({ visible, onDismiss, children, dismissLabel }: BottomSheetProps) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15,19,28,0.45)' }}
        />
        <View
          style={{
            backgroundColor: t.colors.surfaceRaised,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingHorizontal: 18,
            paddingTop: t.space[3],
            paddingBottom: t.space[6],
            gap: t.space[3],
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.border }} />
          {children}
        </View>
      </View>
    </Modal>
  );
}
