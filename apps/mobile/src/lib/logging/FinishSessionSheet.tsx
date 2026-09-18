import { LOGGING_LIMITS } from '@forge/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Text, TextField } from '../../ui';

export type FinishSessionSheetProps = {
  visible: boolean;
  submitting: boolean;
  error: string | null;
  onConfirm: (rating: number | null, notes: string | null) => void;
  onDismiss: () => void;
};

/** Spec §5.3: rating 1–5 (chk_ws_rating) and a note, then complete_workout_session. */
export function FinishSessionSheet({ visible, submitting, error, onConfirm, onDismiss }: FinishSessionSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('logging.finish.cancel')}
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View
          style={{
            padding: theme.space[5],
            gap: theme.space[3],
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
          }}
        >
          <Text variant="h3">{t('logging.finish.title')}</Text>
          <Text tone="secondary">{t('logging.finish.body')}</Text>
          {error ? <Banner variant="danger" message={error} /> : null}
          <Text variant="label">{t('logging.finish.rating')}</Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = rating !== null && n <= rating;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rating === n }}
                  accessibilityLabel={String(n)}
                  onPress={() => setRating(rating === n ? null : n)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: filled ? theme.colors.accent : theme.colors.surfaceRaised,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text numeric variant="bodyBold" style={{ color: filled ? theme.colors.onAccent : theme.colors.textPrimary }}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextField
            label={t('logging.finish.notes')}
            placeholder={t('logging.finish.notesPlaceholder')}
            value={notes}
            onChangeText={setNotes}
            maxLength={LOGGING_LIMITS.session_notes}
            multiline
          />
          <Button
            label={t('logging.finish.confirm')}
            size="lg"
            loading={submitting}
            onPress={() => onConfirm(rating, notes.trim() === '' ? null : notes.trim())}
          />
          <Button label={t('logging.finish.cancel')} variant="link" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}
