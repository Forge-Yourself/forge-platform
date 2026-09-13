import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export type ScreenProps = ViewProps & {
  /**
   * Off for screens that own their own insets — anything with a sticky header, a
   * pinned footer, or a list whose rows must scroll under the title. Those need the
   * gutter applied per-region, not once around everything.
   */
  padded?: boolean;
};

export function Screen({ style, padded = true, children, ...rest }: ScreenProps) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.colors.surface }]}>
      <View {...rest} style={[styles.fill, padded ? { padding: t.space[5] } : null, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
