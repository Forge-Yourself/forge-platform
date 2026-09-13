import { I18nManager, Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';

export type SearchFieldProps = Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
  /** Shown inside the field — a search box states its job in the field, not above it. */
  placeholder: string;
  /** Screen-reader name. Defaults to the placeholder. */
  accessibilityLabel?: string;
};

/**
 * The roster/library search box.
 *
 * TextField was standing in for this, which meant every search box carried a
 * floating uppercase label ("SEARCH 205 EXERCISES") over an empty input — a form
 * field's chrome on a control that is not part of a form. A search box is
 * placeholder-first with a leading magnifier and a clear affordance, which is
 * what the prototype draws and what the platform conventions expect.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  ...rest
}: SearchFieldProps) {
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space[2],
        minHeight: 44,
        paddingHorizontal: t.space[3],
        borderRadius: t.radius.md,
        borderWidth: 1.5,
        borderColor: t.colors.borderStrong,
        backgroundColor: t.colors.surfaceRaised,
      }}
    >
      <Icon name="search" size={18} color={t.colors.textMuted} />
      <TextInput
        accessibilityLabel={accessibilityLabel ?? placeholder}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        {...rest}
        style={{
          flex: 1,
          fontSize: 15,
          paddingVertical: 11,
          color: t.colors.textPrimary,
          textAlign: I18nManager.isRTL ? 'right' : 'left',
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
          style={{ minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={16} color={t.colors.textMuted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}
