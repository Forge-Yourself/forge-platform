import { unitLabel } from '@forge/shared';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { FinishSessionSheet } from '../../lib/logging/FinishSessionSheet';
import { nameOf, shownNumber, type SessionController } from '../../lib/logging/useSessionController';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { NumericKeypad } from '../NumericKeypad';
import { PrMoment } from '../PrMoment';
import { RestTimer } from '../RestTimer';
import { Text } from '../Text';
import { EditSetSheet } from './EditSetSheet';

/** The modal layer of an in-progress session: keypad, edit, full-screen rest, PR, finish. */
export function SessionSheets({ c }: { c: SessionController }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const {
    unit, keypad, setKeypad, keypadText, setKeypadText, keypadCommit, editing, setEditing, submitSet, removeSet,
    timerOpen, setTimerOpen, rest, current, canLog, draft, pr, setPr, finishOpen, setFinishOpen, finishing,
    finishError, finishDraft, finish,
  } = c;
  return (
    <>
      {/* Keypad sheet */}
      <Modal
        visible={keypad !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setKeypad(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => setKeypad(null)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}
          />
          <View
            style={{
              padding: theme.space[4],
              gap: theme.space[3],
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
            }}
          >
            <Text variant="label" tone="muted">
              {keypad === 'weight'
                ? t('logging.session.weight') + ' · ' + unitLabel(unit)
                : keypad === 'rpe'
                  ? t('logging.session.rpe')
                  : t('logging.session.reps')}
            </Text>
            <Text numeric style={{ fontSize: 40, fontWeight: '700' }}>
              {keypadText === '' ? '—' : keypadText}
            </Text>
            <NumericKeypad
              onKey={(d) => setKeypadText((v) => (v.length >= 6 ? v : v + d))}
              onDelete={() => setKeypadText((v) => v.slice(0, -1))}
              extraKey={
                keypad === 'weight' || keypad === 'rpe'
                  ? {
                      label: '.',
                      onPress: () =>
                        setKeypadText((v) => (v.includes('.') || v === '' ? v : v + '.')),
                    }
                  : undefined
              }
            />
            <Button label={t('common.done')} size="lg" onPress={keypadCommit} />
          </View>
        </View>
      </Modal>

      {/* Edit sheet */}
      <Modal
        visible={editing !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        {editing ? (
          <EditSetSheet
            set={editing}
            unit={unit}
            onSave={(values) => {
              const s = editing;
              setEditing(null);
              void submitSet(s, values);
            }}
            onDelete={() => {
              const s = editing;
              setEditing(null);
              void removeSet(s);
            }}
            onDismiss={() => setEditing(null)}
          />
        ) : null}
      </Modal>

      {/* Full-screen rest timer (prototype `timer`), opened from the strip. */}
      <Modal visible={timerOpen && rest.active} animationType="fade" onRequestClose={() => setTimerOpen(false)}>
        {rest.active && current ? (
          <RestTimer
            phase={rest.phase}
            remaining={rest.remaining}
            progress={rest.progress}
            labels={{
              kicker:
                rest.total !== null && rest.setNumber <= rest.total
                  ? t('logging.timer.rest', { n: rest.setNumber, total: rest.total })
                  : t('logging.timer.restSimple'),
              exercise: nameOf(current),
              hint:
                rest.phase === 'complete'
                  ? t('logging.timer.hintComplete')
                  : t('logging.timer.hintRunning', {
                      summary: canLog
                        ? `${draft.weightKg === null ? '—' : shownNumber(draft.weightKg, unit)} ${unitLabel(unit)} × ${draft.reps ?? '—'}`
                        : '—',
                    }),
              state: {
                running: t('logging.timer.running'),
                paused: t('logging.timer.paused'),
                complete: t('logging.timer.complete'),
              },
              pause: t('logging.timer.pause'),
              resume: t('logging.timer.resume'),
              plus30: t('logging.timer.plus30'),
              skip: t('logging.timer.skip'),
              back: t('logging.timer.back'),
            }}
            onToggle={rest.togglePause}
            onPlus30={rest.plus30}
            onSkip={() => {
              rest.clear();
              setTimerOpen(false);
            }}
            onDone={() => {
              rest.clear();
              setTimerOpen(false);
            }}
          />
        ) : null}
      </Modal>

      {pr ? (
        <PrMoment
          visible
          kicker={t('logging.pr.kicker')}
          {...pr}
          keepGoingLabel={t('logging.pr.keepGoing')}
          onClose={() => setPr(null)}
        />
      ) : null}

      <FinishSessionSheet
        key={finishOpen ? 'open' : 'closed'}
        visible={finishOpen}
        submitting={finishing}
        error={finishError}
        initialNotes={finishDraft}
        onConfirm={(r, n) => void finish(r, n)}
        onDismiss={() => setFinishOpen(false)}
      />
    </>
  );
}
