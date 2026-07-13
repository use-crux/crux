import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import { createCompositeEventPort } from './composite_events'
import { createCompositeOutboxPort } from './composite_outbox'
import { createCompositeStatePort } from './composite_state'
import { createCompositeTimerPort } from './composite_timers'
import { createCompositeWaiterPort } from './composite_waiters'
import { createCompositeDeferredStore } from './composite_deferred'

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
    deferred: createCompositeDeferredStore(ctx),
  }
}
