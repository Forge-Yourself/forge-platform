import type { TFunction } from 'i18next';
import { timeLabel } from './format';
import type { ScheduleItem } from './useSchedule';

/** What a CalendarBlock shows for a booking. Shared by the phone views and the iPad week grid. */
export function blockProps(item: ScheduleItem, t: TFunction) {
  return {
    state: item.state,
    stateLabel: t(`schedule.states.${item.state}`),
    title: item.isSelf ? t('schedule.me') : item.name,
    subtitle: `${timeLabel(item.startsAt)}–${timeLabel(item.endsAt)}`,
    note:
      item.cancelLate && item.cancelledAt
        ? t('schedule.lateCancelNote', { time: timeLabel(item.cancelledAt) })
        : item.overlap
          ? item.overlap.title
            ? t('calendar.scheduleNote', { title: item.overlap.title, time: timeLabel(item.overlap.start) })
            : t('calendar.scheduleNoteNoTitle', { time: timeLabel(item.overlap.start) })
          : undefined,
    // The design prints the Google overlap in warning text; a late cancel stays muted.
    noteTone: !item.cancelLate && item.overlap ? ('warn' as const) : ('muted' as const),
  };
}
