import { PendingQueue, type PendingOp, type RpcError, type RpcResult } from '@forge/shared';
import { kvStore } from '../offline/kvStore';
import { callCheckIn, callRate } from './api';

function toRpcError(error: { code?: string; message?: string }): RpcError {
  return { code: error.code ?? '', message: error.message ?? '' };
}

/** Device-level, one per process. Every rule about the queue is in PendingQueue (vitest). */
export const pendingQueue = new PendingQueue(kvStore, {
  async send(op: PendingOp): Promise<RpcResult<unknown>> {
    const { error } =
      op.kind === 'check_in' ? await callCheckIn(op.args) : await callRate(op.args.p_id, op.args.p_rating, op.args.p_comment);
    return error ? { ok: false, error: toRpcError(error) } : { ok: true, data: null };
  },
});

