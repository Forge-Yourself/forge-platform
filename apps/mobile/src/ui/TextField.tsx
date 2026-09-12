import { useState } from 'react';
import {
  I18nManager,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Error and helper/success text are mutually exclusive — only one renders at a time. */
  error?: string;
  helperText?: string;
  success?: boolean;
};

/**
 * Themed text input. Error/success border + message state is driven by `error`/`success`
 * props (mutually exclusive with `helperText`) rather than a raw style prop, so consumers
 * can't accidentally render both an error and a helper message at once.
 */
export function TextField({
  label,
  error,
  helperText,
  success,
  secureTextEntry,
  ...rest
}: TextFieldProps) {
  const t = useTheme();
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;

  const borderColor = error
    ? t.colors.dangerAccent
    : success
      ? t.colors.successAccent
      : t.colors.borderStrong;

  const message = error ?? helperText;
  const messageTone = error
    ? t.colors.dangerAccent
    : success
      ? t.colors.successAccent
      : t.colors.textMuted;

  return (
    <View style={styles.container}>
      <Text
        style={[
          styles.label,
          { color: t.colors.textMuted, marginBottom: t.space[1] + 2 },
        ]}
      >
        {label.toUpperCase()}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={t.colors.textMuted}
          secureTextEntry={isPassword && !revealed}
          {...rest}
          style={[
            styles.input,
            {
              fontSize: 15,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: t.radius.md,
              borderWidth: 1.5,
              borderColor,
              minHeight: 44,
              color: t.colors.textPrimary,
              textAlign: I18nManager.isRTL ? 'right' : 'left',
              paddingEnd: isPassword ? 48 : 14,
            },
          ]}
        />
        {isPassword && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            style={[styles.reveal, { minHeight: t.touchTarget, minWidth: t.touchTarget }]}
          >
            <Text tone="muted" variant="caption">
              {revealed ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        )}
      </View>
      {message ? (
        <Text style={[styles.message, { color: messageTone, marginTop: t.space[1] }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    width: '100%',
  },
  reveal: {
    position: 'absolute',
    insetInlineEnd: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  message: {
    fontSize: 12,
    fontWeight: '500',
  },
});
