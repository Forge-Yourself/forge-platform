import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Screen } from './Screen';

export type FormScreenProps = {
  children: ReactNode;
  /** Sticky primary-action area pinned to the bottom third (gym-floor-ergonomics constraint). */
  footer?: ReactNode;
};

/** Screen + keyboard avoidance + scrollable form body + sticky footer, for every M1 form. */
export function FormScreen({ children, footer }: FormScreenProps) {
  const t = useTheme();

  return (
    <Screen style={{ padding: 0 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
