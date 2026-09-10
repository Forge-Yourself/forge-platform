import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export function Screen({ style, children, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.colors.surface }]}>
      <View {...rest} style={[styles.fill, { padding: t.space[5] }, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
