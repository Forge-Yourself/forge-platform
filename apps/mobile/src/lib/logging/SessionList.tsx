import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ListRow, SectionCard, Tag } from '../../ui';
import type { SessionHistoryItem } from './useSessionHistory';

/**
 * "Week 2 · Day 3", "Push A · Week 2", or "Freestyle".
 *
 * A freestyle session is the one with neither a program day nor a week — a
 * session whose `program_day_id` was nulled because the day was rebuilt still
 * carries its week/day numbers, and reads as the programmed day it was.
 */
export function sessionTitle(s: SessionHistoryItem, t: TFunction): string {
  if (s.program_day_id === null && s.week_number === null) return t('logging.history.freestyle');
  if (s.day_label) return t('logging.history.dayLabelNamed', { label: s.day_label, week: s.week_number ?? 1 });
  return t('logging.history.dayLabel', { week: s.week_number ?? 1, day: s.day_number ?? 1 });
}

export type SessionListProps = {
  items: SessionHistoryItem[];
  /** Caps the rows rendered — the two home/detail previews show 3, the "See all" routes show everything. */
  limit?: number;
};

/**
 * The session history row, spec §5.4 — day label or "Freestyle", the date, the
 * set count, and a tag: IN PROGRESS wins over the Coach tag, because a session
 * still running is the one thing on the row worth acting on.
 *
 * `useSessionHistory` already filters to in_progress + completed, so there is
 * no status filter here.
 */
export function SessionList({ items, limit }: SessionListProps) {
  const { t } = useTranslation();
  const rows = limit ? items.slice(0, limit) : items;

  return (
    <SectionCard>
      {rows.map((s) => (
        <ListRow
          key={s.id}
          minHeight={64}
          title={sessionTitle(s, t)}
          subtitle={
            new Date(s.started_at ?? s.created_at).toLocaleDateString() +
            ' · ' +
            t('logging.history.sets', { count: s.setCount })
          }
          trailing={
            s.status === 'in_progress' ? (
              <Tag label={t('logging.history.inProgress')} tone="accent" />
            ) : s.is_pt_led ? (
              <Tag label={t('logging.session.coachTag')} tone="neutral" />
            ) : undefined
          }
          onPress={() => router.push({ pathname: '/(app)/sessions/[id]', params: { id: s.id } })}
        />
      ))}
    </SectionCard>
  );
}
