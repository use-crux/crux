import { runWithCapturedAsyncScope } from '../../async-scope/internal/carrier'
import type { RuntimeTaskTarget } from '../../runtime/api/task'
import { createDeferError } from '../errors'
import type { DeferInvocationOutcome } from '../host-types'
import type { DeferredCallback, DeferredWorkRef } from '../types'
import { createDeferCommitBarrier } from './commit-barrier'
import {
  runWithDeferRegistration,
  type DeferRegistrationContext,
  type DeferRegistrationScope,
} from './context'
import { createDurableDeferController } from './durable'
import type {
  InlineRegistration,
  ScopeDeferController,
} from './invocation-scope'

/** Internal callback failure retained for diagnostics without becoming public API. */
export interface DeferredCallbackFailure extends Error {
  readonly code: 'DEFER_CALLBACK_FAILED'
  readonly cause: unknown
}

/** Execute one callback in its captured causal scope and fresh named-commit scope. */
export async function executeDeferredCallback(
  parent: ScopeDeferController,
  registration: InlineRegistration,
  policy: { readonly durableFinalization: boolean },
): Promise<void> {
  await runWithCapturedAsyncScope(registration.capturedScope, async () => {
    const child = createCallbackCommitScope(parent, policy)
    let settlement:
      | { readonly kind: 'returned' }
      | { readonly kind: 'thrown'; readonly error: unknown }

    try {
      await runWithDeferRegistration(
        { scope: child, phase: 'drain', depth: registration.depth + 1 },
        registration.callback,
      )
      settlement = { kind: 'returned' }
    } catch (error) {
      settlement = { kind: 'thrown', error }
    }

    const committed = child.seal(
      settlement.kind === 'returned' ? 'success' : 'error',
    )
    try {
      await committed
    } catch (cause) {
      throw callbackFailed(commitFailed(cause))
    }
    if (settlement.kind === 'thrown') {
      throw callbackFailed(settlement.error)
    }
  })
}

interface CallbackCommitScope extends DeferRegistrationScope {
  seal(outcome: DeferInvocationOutcome): Promise<void>
}

function createCallbackCommitScope(
  parent: ScopeDeferController,
  policy: { readonly durableFinalization: boolean },
): CallbackCommitScope {
  let state: 'open' | 'sealed' = 'open'
  let committed: Promise<void> | undefined
  const barrier = createDeferCommitBarrier()
  // Own durable session for nested commit isolation, but public named evidence
  // goes through the owning invocation controller (same run, no duplicate roots).
  const durable = createDurableDeferController(
    policy,
    parent.namedEvidenceHooks,
  )

  const child: CallbackCommitScope = {
    registerInline(callback, registration) {
      parent.registerInline(callback, parentRegistration(parent, registration))
    },
    stageNamed(
      target: RuntimeTaskTarget,
      input: unknown,
    ): Promise<DeferredWorkRef> {
      assertOpen(state)
      const operation = durable.stage(target, input)
      child.trackCommit(operation)
      return operation
    },
    trackCommit(operation) {
      assertOpen(state)
      barrier.track(operation)
    },
    seal(outcome) {
      if (committed) return committed
      state = 'sealed'
      committed = durable.commit(outcome, barrier.settle())
      return committed
    },
  }
  return child
}

function parentRegistration(
  parent: ScopeDeferController,
  registration: DeferRegistrationContext,
): DeferRegistrationContext {
  return {
    scope: parent,
    phase: 'drain',
    depth: registration.depth,
  }
}

function assertOpen(state: 'open' | 'sealed'): void {
  if (state === 'open') return
  throw createDeferError({
    code: 'DEFER_SCOPE_SEALED',
    message: 'defer() cannot stage durable callback work after sealing.',
  })
}

function commitFailed(cause: unknown): Error {
  return createDeferError({
    code: 'DEFER_COMMIT_FAILED',
    message: 'Deferred callback work could not be committed.',
    cause,
  })
}

function callbackFailed(cause: unknown): DeferredCallbackFailure {
  return Object.assign(
    new Error('A deferred callback failed after the parent result committed.', {
      cause,
    }),
    {
      name: 'DeferredCallbackError',
      code: 'DEFER_CALLBACK_FAILED' as const,
      cause,
    },
  )
}
