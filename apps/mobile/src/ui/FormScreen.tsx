import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Screen } from './Screen';

export type FormScreenProps = {
  children: ReactNode;
  /**
   * Pinned chrome above the scroll body — a `NavHeader` carrying the screen's back
   * or cancel control. It sits OUTSIDE the ScrollView on purpose: a back control
   * that scrolls away is a back control the user cannot find.
   */
  header?: ReactNode;
  /** Sticky primary-action area pinned to the bottom third (gym-floor-ergonomics constraint). */
  footer?: ReactNode;
};

/** Screen + keyboard avoidance + scrollable form body + sticky footer, for every M1 form. */
export function FormScreen({ children, header, footer }: FormScreenProps) {
  const t = useTheme();

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header ?? null}
        <ScrollView
          contentContainerStyle={{ padding: t.space[5], flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? (
          <View style={{ padding: t.space[5], paddingTop: t.space[3] }}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
