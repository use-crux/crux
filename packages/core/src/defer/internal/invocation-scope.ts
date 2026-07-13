import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from '../host-types'
import type { DeferredCallback } from '../types'
import { createDeferError } from '../errors'
import {
  captureAsyncScope,
  type CapturedAsyncScope,
} from '../../async-scope/internal/carrier'
import {
  type DeferRegistrationContext,
  type DeferRegistrationScope,
} from './context'
import { drainInlineCallbacks } from './drain'
import {
  createDurableDeferController,
  type DurableDeferEvidenceHooks,
} from './durable'
import { createDeferCommitBarrier } from './commit-barrier'
import {
  createDeferScopeObservability,
  type DeferredScheduledObservation,
  type DeferEvidencePolicy,
} from './observability'

type InvocationState = 'open' | 'sealed'
type DeferredCallbackOutcome =
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'cancelled'

export interface InlineRegistration {
  readonly sequence: number
  readonly depth: number
  readonly callback: DeferredCallback
  readonly capturedScope: CapturedAsyncScope
  readonly observation: DeferredScheduledObservation
}

/** Result retained internally for shutdown, tests, and later diagnostics. */
export interface DeferredDrainResult {
  readonly callbacks: readonly {
    readonly sequence: number
    readonly outcome: DeferredCallbackOutcome
    readonly error?: unknown
  }[]
  readonly timedOut: boolean
  readonly cancelled: boolean
}

/** Internal barriers created when an invocation is sealed. */
export interface DeferredDrainHandle {
  readonly committed: Promise<void>
  readonly settled: Promise<DeferredDrainResult>
}

/** Package-private invocation state machine. */
export interface InvocationDeferScope extends DeferRegistrationScope {
  /** Cooperative signal aborted when bounded drain settlement stops waiting. */
  readonly signal: AbortSignal
  /**
   * Shared public evidence hooks for nested callback named staging.
   *
   * Child commit scopes create their own durable controller but must emit
   * scheduled/run evidence through the owning invocation controller.
   */
  readonly namedEvidenceHooks: DurableDeferEvidenceHooks
  /** Stop waiting for callback settlement during shutdown or host cancellation. */
  cancel(reason?: unknown): void
  seal(outcome: DeferInvocationOutcome): DeferredDrainHandle
}

/** Create one invocation-scoped deferred-work kernel. */
export function createInvocationDeferScope(
  lifetime: DeferLifetimeCapability,
): InvocationDeferScope {
  let state: InvocationState = 'open'
  let drainClosed = false
  let handle: DeferredDrainHandle | undefined
  const registrations: InlineRegistration[] = []
  const commitBarrier = createDeferCommitBarrier()
  const abortController = new AbortController()
  const evidence = createDeferScopeObservability({
    completion: lifetime.completion,
  })
  const namedEvidenceHooks: DurableDeferEvidenceHooks = {
    ensurePublicCorrelators() {
      return evidence.ensurePublicCorrelators()
    },
    onStaged(input) {
      const observation = evidence.recordNamedScheduled({
        sequence: input.sequence,
        policy: 'public',
        targetId: input.targetId,
        workId: input.workId,
        scopeId: input.scopeId,
        scheduledSpanId: input.scheduledSpanId,
      })
      return {
        ...(observation.spanId ? { spanId: observation.spanId } : {}),
      }
    },
    onTerminal(intents, intentState) {
      for (const intent of intents) {
        evidence.markNamedTerminal(
          {
            policy: 'public',
            sequence: intent.sequence,
            mode: 'named',
            completion: lifetime.completion,
            scheduledAtMs: intent.scheduledAtMs,
            workId: intent.workId,
            targetId: intent.targetId,
            scopeId: intent.scopeId,
          },
          intentState,
        )
      }
    },
  }
  const durable = createDurableDeferController(lifetime, namedEvidenceHooks)

  const scope: InvocationDeferScope = {
    signal: abortController.signal,
    namedEvidenceHooks,
    cancel(reason) {
      abortController.abort(
        reason ?? new Error('Deferred callback drain was cancelled.'),
      )
    },
    registerInline(callback, registration) {
      if ((state !== 'open' && registration.phase !== 'drain') || drainClosed) {
        throw createDeferError({
          code: 'DEFER_SCOPE_SEALED',
          message:
            'defer() cannot register work after its invocation was sealed.',
        })
      }
      if (!lifetime.supportsInline) {
        throw createDeferError({
          code: 'DEFER_CAPABILITY_MISSING',
          message:
            'The active host does not support inline defer(callback). Use await defer(target, input) with a configured Runtime, or install a host lifetime integration.',
        })
      }
      if (registrations.length >= lifetime.limits.maxCallbacks) {
        throw createDeferError({
          code: 'DEFER_LIMIT_EXCEEDED',
          message: `defer() exceeded the host callback limit of ${lifetime.limits.maxCallbacks}.`,
        })
      }
      if (
        registration.phase === 'drain' &&
        registration.depth > lifetime.limits.maxNestingDepth
      ) {
        throw createDeferError({
          code: 'DEFER_LIMIT_EXCEEDED',
          message: `defer() exceeded the host nesting limit of ${lifetime.limits.maxNestingDepth}.`,
        })
      }
      const policy: DeferEvidencePolicy = registration.evidence ?? 'public'
      const sequence = registrations.length
      const observation = evidence.recordInlineScheduled(sequence, policy)
      registrations.push({
        sequence,
        depth: registration.depth,
        callback,
        capturedScope: captureAsyncScope(),
        observation,
      })
    },
    stageNamed(target, input) {
      if (state !== 'open') {
        throw createDeferError({
          code: 'DEFER_SCOPE_SEALED',
          message: 'defer() cannot stage durable work after sealing.',
        })
      }
      const operation = durable.stage(target, input)
      scope.trackCommit(operation)
      return operation
    },
    trackCommit(operation) {
      if (state !== 'open') {
        throw createDeferError({
          code: 'DEFER_SCOPE_SEALED',
          message: 'defer() cannot track durable acceptance after sealing.',
        })
      }
      commitBarrier.track(operation)
    },
    seal(outcome) {
      void outcome
      if (handle) return handle
      state = 'sealed'

      const settlement = deferred<DeferredDrainResult>()
      const committed = durable.commit(outcome, commitBarrier.settle())
      // Named acceptance/finalization owns public scheduled spans; keep the
      // optional grouped run open until that path is terminal even when the
      // empty/fast inline drain settles first. Public `settled` stays independent.
      evidence.trackNamedLifecycle(committed)
      handle = {
        committed,
        settled: settlement.promise,
      }
      lifetime.schedule({
        async run() {
          const result = await drainInlineCallbacks(scope, registrations, {
            concurrency: lifetime.limits.concurrency,
            maxDrainMs: lifetime.limits.maxDrainMs,
            lifetime,
            abortController,
            evidence,
            close: () => {
              drainClosed = true
            },
          })
          evidence.settle(result)
          settlement.resolve(result)
        },
        cancel(reason) {
          scope.cancel(reason)
        },
      })
      return handle
    },
  }

  return scope
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value)
    },
  }
}
