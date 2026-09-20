import type { RestState } from '@forge/shared';
import * as Linking from 'expo-linking';
import type { TFunction } from 'i18next';
import type { RestActivityPayload } from './types';

/** The lock-screen copy for one rest (prototype `lock`): "Bench press · set 3 of 4", "Next: 100 kg × 8 · Maya". */
export function payloadFor(r: RestState, t: TFunction): RestActivityPayload {
  const title =
    r.total !== null && r.setNumber <= r.total
      ? t('logging.lock.title', { exercise: r.exerciseName, n: r.setNumber, total: r.total })
      : t('logging.lock.titleSimple', { exercise: r.exerciseName, n: r.setNumber });
  const text = r.clientName
    ? t('logging.lock.next', { summary: r.nextLabel, name: r.clientName })
    : t('logging.lock.nextNoName', { summary: r.nextLabel });
  return {
    sessionId: r.sessionId,
    startedAt: r.endsAt - r.totalMs,
    endsAt: r.endsAt,
    kicker: t('logging.lock.kicker'),
    title,
    text,
    url: Linking.createURL(`/sessions/${r.sessionId}`),
    labels: {
      plus30: t('logging.lock.plus30'),
      skip: t('logging.lock.skip'),
      channel: t('logging.lock.channel'),
      channelDone: t('logging.lock.channelDone'),
      doneTitle: t('logging.lock.doneTitle'),
      doneBody: t('logging.lock.doneBody', { exercise: r.exerciseName }),
    },
  };
}
