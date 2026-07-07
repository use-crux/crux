import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import { createCompositeEventPort } from './composite-events'
import { createCompositeOutboxPort } from './composite-outbox'
import { createCompositeStatePort } from './composite-state'
import { createCompositeTimerPort } from './composite-timers'
import { createCompositeWaiterPort } from './composite-waiters'

/** Build the component-local transaction view used by composite bodies. */
export function createCompositeTransaction(
  ctx: MutationCtx,
): RuntimeStoreTransaction {
  return {
    state: createCompositeStatePort(ctx),
    events: createCompositeEventPort(ctx),
    waiters: createCompositeWaiterPort(ctx),
    timers: createCompositeTimerPort(ctx),
    outbox: createCompositeOutboxPort(ctx),
  }
}
