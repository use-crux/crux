/**
 * Scoped-idle accounting helpers for terminal work transitions.
 *
 * The state store owns the counter storage, while the kernel owns when a work
 * item enters or leaves the non-terminal set for a scope.
 *
 * @module
 */

import type { RuntimeStoreTransaction } from '../store'
import {
  emitEventInTransaction,
  type EmitEventInTransactionDeps,
} from './kernel-events'
import { isTerminalWork } from './kernel-shared'
import type { RuntimeWorkItem } from './work'

/** Persist a work transition and emit scoped idle when it reaches zero. */
export async function putWorkWithIdleAccounting(
  tx: RuntimeStoreTransaction,
  deps: EmitEventInTransactionDeps,
  previous: RuntimeWorkItem,
  next: RuntimeWorkItem,
): Promise<void> {
  await tx.state.putWork(next)
  if (!previous.idleScope || !enteredTerminal(previous, next)) return

  const count = await tx.state.decrementIdle(
    previous.namespace,
    previous.idleScope,
  )
  if (count !== 0) return

  await emitEventInTransaction(tx, deps, {
    namespace: previous.namespace,
    name: `crux.idle:${previous.idleScope}`,
    payload: { scope: previous.idleScope },
  })
}

function enteredTerminal(previous: RuntimeWorkItem, next: RuntimeWorkItem): boolean {
  return !isTerminalWork(previous) && isTerminalWork(next)
}
