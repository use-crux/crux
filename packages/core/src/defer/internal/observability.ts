/**
 * Public and diagnostics-only evidence policy for request-scoped `defer()`.
 *
 * Public registrations emit `defer.scheduled` / `defer.run` with a causal
 * `triggered` edge. When no originating Crux run exists, one lightweight
 * grouped run is opened for the invocation scope. The diagnostics-only
 * composition port creates no Catalog noise and no user Run or deferred spans.
 *
 * @module
 */

import {
  observe,
  type CapturedObservabilityContext,
  type CruxSpanId,
  type OpenObservedRun,
  type OpenObservedSpan,
} from '../../observability'
import type { DeferCompletionClass } from '../host-types'
import type { DeferredDrainResult } from './invocation-scope'

/** Whether a registration is user-authored or first-party internal composition. */
export type DeferEvidencePolicy = 'public' | 'diagnostics-only'

/** Handle retained so execution can open a causally linked `defer.run` span. */
export interface DeferredScheduledObservation {
  readonly policy: DeferEvidencePolicy
  readonly sequence: number
  readonly mode: 'inline' | 'named'
  readonly completion: DeferCompletionClass
  readonly scheduledAtMs: number
  readonly spanId?: CruxSpanId
  readonly context?: CapturedObservabilityContext
  /** Named acceptance identity retained through terminal span-end attributes. */
  readonly targetId?: string
  readonly workId?: string
  readonly scopeId?: string
  /**
   * Catalog definition id when a compiler-runtime join supplies it.
   * Runtime does not invent definitionId.
   */
  readonly definitionId?: string
}

/** Open named scheduled span plus identity needed at terminal close. */
interface OpenNamedScheduled {
  readonly span: OpenObservedSpan
  readonly sequence: number
  readonly targetId: string
  readonly workId: string
  readonly scopeId?: string
  readonly definitionId?: string
}

interface CreateDeferScopeObservabilityOptions {
  readonly completion: DeferCompletionClass
}

/** Per-invocation evidence controller shared by registration and drain. */
export interface DeferScopeObservability {
  /**
   * Record that one public or diagnostics-only inline callback was accepted.
   *
   * Public policy emits an instantaneous `defer.scheduled` span. Diagnostics-only
   * policy records sequencing metadata without graph emission.
   */
  recordInlineScheduled(
    sequence: number,
    policy: DeferEvidencePolicy,
  ): DeferredScheduledObservation

  /**
   * Ensure a public grouped/originating run exists and return its correlators.
   *
   * Used before durable named acceptance so provenance can carry run/trace ids
   * into released work without opening a scheduled span early.
   */
  ensurePublicCorrelators(): {
    readonly runId: string
    readonly traceId: string
  }

  /**
   * Record durable named acceptance for one staged target.
   *
   * The scheduled span stays open until {@link markNamedTerminal} so intent
   * state transitions remain visible as a single unit of work.
   */
  recordNamedScheduled(input: {
    readonly sequence: number
    readonly policy: DeferEvidencePolicy
    readonly targetId: string
    readonly workId: string
    readonly scopeId?: string
    readonly definitionId?: string
    /** Predetermined span id persisted on durable provenance for causal wake. */
    readonly scheduledSpanId: string
  }): DeferredScheduledObservation & {
    readonly targetId: string
    readonly workId: string
    readonly openSpan?: OpenObservedSpan
  }

  /** Close a named scheduled span only when its exact durable work id is open. */
  markNamedTerminal(
    observation: DeferredScheduledObservation & {
      readonly workId: string
      readonly openSpan?: OpenObservedSpan
    },
    intentState: 'released' | 'abandoned',
    status?: 'ok' | 'cancelled' | 'error',
  ): void

  /**
   * Execute one callback under a `defer.run` span causally linked to its
   * scheduled observation.
   */
  runInline(
    observation: DeferredScheduledObservation,
    execute: () => Promise<void>,
  ): Promise<void>

  /**
   * Record that the inline drain finished.
   *
   * This must not end an owned grouped run while named acceptance/finalization
   * can still open or close public evidence. The public `settled` promise may
   * resolve from this signal independently of named commit.
   */
  settle(result: DeferredDrainResult): void

  /**
   * Keep the owned grouped run open until the invocation's named commit path
   * settles (success or failure), including ignored caller stage promises.
   */
  trackNamedLifecycle(commit: Promise<unknown>): void
}

/**
 * Create the evidence controller for one invocation scope.
 *
 * The controller is lazy: no run is opened until the first public registration.
 */
export function createDeferScopeObservability(
  options: CreateDeferScopeObservabilityOptions,
): DeferScopeObservability {
  let groupedRun: OpenObservedRun | undefined
  let ownedGroupedRun = false
  let baseContext: CapturedObservabilityContext | undefined
  // Keyed by workId so nested callback scopes cannot collide on sequence 0.
  const openNamed = new Map<string, OpenNamedScheduled>()
  let drainSettled = false
  let drainResult: DeferredDrainResult | undefined
  let namedLifecyclePending = false
  let namedTerminalStatus: 'ok' | 'cancelled' | 'error' | undefined
  let runEnded = false

  function ensurePublicContext(): CapturedObservabilityContext {
    if (baseContext) return baseContext

    const current = observe.captureContext()
    if (current) {
      baseContext = {
        runId: current.runId,
        traceId: current.traceId,
        ...(current.startedAtMs !== undefined
          ? { startedAtMs: current.startedAtMs }
          : {}),
        ...(current.correlators !== undefined
          ? { correlators: current.correlators }
          : {}),
        // Capture the active parent stack for scheduled emission, but keep the
        // run identity for later causal execution that must not nest under a
        // closed response span.
        spanStack: [...current.spanStack],
        ...(current.currentSpanId
          ? { currentSpanId: current.currentSpanId }
          : {}),
      }
      return baseContext
    }

    groupedRun = observe.openRun({
      name: 'deferred work',
      rootPrimitive: 'defer.scheduled',
      attributes: {
        completion: options.completion,
      },
    })
    ownedGroupedRun = true
    baseContext = groupedRun.captureContext()
    return baseContext
  }

  function withPublicContext<T>(
    context: CapturedObservabilityContext,
    fn: () => T,
  ): T {
    return observe.withContext(context, fn) as T
  }

  const api: DeferScopeObservability = {
    ensurePublicCorrelators() {
      const context = ensurePublicContext()
      return {
        runId: context.runId,
        traceId: context.traceId,
      }
    },

    recordInlineScheduled(sequence, policy) {
      const scheduledAtMs = Date.now()
      if (policy === 'diagnostics-only') {
        // Capture owning primitive context so failure events can attach after
        // the response boundary without creating deferred spans/runs.
        const context = observe.captureContext()
        return {
          policy,
          sequence,
          mode: 'inline' as const,
          completion: options.completion,
          scheduledAtMs,
          ...(context
            ? {
                context: {
                  runId: context.runId,
                  traceId: context.traceId,
                  ...(context.startedAtMs !== undefined
                    ? { startedAtMs: context.startedAtMs }
                    : {}),
                  ...(context.correlators !== undefined
                    ? { correlators: context.correlators }
                    : {}),
                  spanStack: [...context.spanStack],
                  ...(context.currentSpanId
                    ? { currentSpanId: context.currentSpanId }
                    : {}),
                },
              }
            : {}),
        }
      }

      const context = ensurePublicContext()
      let spanId: CruxSpanId | undefined
      withPublicContext(context, () => {
        const span = observe.openSpan({
          name: `defer inline #${sequence}`,
          primitive: 'defer.scheduled',
          attributes: {
            mode: 'inline',
            completion: options.completion,
            sequence,
          },
        })
        spanId = span.spanId
        span.end({
          status: 'ok',
          attributes: {
            mode: 'inline',
            completion: options.completion,
            sequence,
          },
        })
      })

      return {
        policy,
        sequence,
        mode: 'inline',
        completion: options.completion,
        scheduledAtMs,
        spanId,
        context: {
          runId: context.runId,
          traceId: context.traceId,
          ...(context.startedAtMs !== undefined
            ? { startedAtMs: context.startedAtMs }
            : {}),
          ...(context.correlators !== undefined
            ? { correlators: context.correlators }
            : {}),
          // Empty stack: execution uses a causal edge, not temporal nesting.
          spanStack: [],
        },
      }
    },

    recordNamedScheduled(input) {
      const scheduledAtMs = Date.now()
      if (input.policy === 'diagnostics-only') {
        return {
          policy: input.policy,
          sequence: input.sequence,
          mode: 'named' as const,
          completion: options.completion,
          scheduledAtMs,
          targetId: input.targetId,
          workId: input.workId,
          ...(input.scopeId ? { scopeId: input.scopeId } : {}),
          ...(input.definitionId ? { definitionId: input.definitionId } : {}),
        }
      }

      const context = ensurePublicContext()
      let openSpan: OpenObservedSpan | undefined
      withPublicContext(context, () => {
        openSpan = observe.openSpan({
          name: `defer named ${input.targetId}`,
          primitive: 'defer.scheduled',
          attributes: {
            mode: 'named',
            completion: options.completion,
            sequence: input.sequence,
            targetId: input.targetId,
            workId: input.workId,
            intentState: 'staged',
            ...(input.scopeId ? { scopeId: input.scopeId } : {}),
            ...(input.definitionId ? { definitionId: input.definitionId } : {}),
          },
          // Use the predetermined id already stored on durable provenance so
          // wake can link without process-local state. definitionId is omitted
          // unless a compiler-runtime join supplies it — never fabricated.
          spanId: input.scheduledSpanId as CruxSpanId,
        })
        openNamed.set(input.workId, {
          span: openSpan,
          sequence: input.sequence,
          targetId: input.targetId,
          workId: input.workId,
          ...(input.scopeId ? { scopeId: input.scopeId } : {}),
          ...(input.definitionId ? { definitionId: input.definitionId } : {}),
        })
      })

      return {
        policy: input.policy,
        sequence: input.sequence,
        mode: 'named' as const,
        completion: options.completion,
        scheduledAtMs,
        spanId: openSpan?.spanId,
        openSpan,
        targetId: input.targetId,
        workId: input.workId,
        ...(input.scopeId ? { scopeId: input.scopeId } : {}),
        ...(input.definitionId ? { definitionId: input.definitionId } : {}),
        context: {
          runId: context.runId,
          traceId: context.traceId,
          ...(context.startedAtMs !== undefined
            ? { startedAtMs: context.startedAtMs }
            : {}),
          ...(context.correlators !== undefined
            ? { correlators: context.correlators }
            : {}),
          spanStack: [],
        },
      }
    },

    markNamedTerminal(observation, intentState, status = 'ok') {
      // Sequences restart in nested callback scopes. Only the durable work id
      // identifies the span that this terminal transition may close.
      const tracked = openNamed.get(observation.workId)
      if (!tracked) return
      const span = tracked.span
      openNamed.delete(tracked.workId)
      const endStatus =
        intentState === 'abandoned'
          ? status === 'ok'
            ? 'cancelled'
            : status
          : status
      if (endStatus === 'error') namedTerminalStatus = 'error'
      else if (endStatus === 'cancelled' && namedTerminalStatus !== 'error') {
        namedTerminalStatus = 'cancelled'
      } else if (namedTerminalStatus === undefined) {
        namedTerminalStatus = 'ok'
      }
      const targetId = observation.targetId ?? tracked.targetId
      const workId = observation.workId
      const scopeId = observation.scopeId ?? tracked.scopeId
      const definitionId = observation.definitionId ?? tracked.definitionId
      span.end({
        status: endStatus,
        attributes: {
          mode: 'named',
          completion: observation.completion,
          sequence: observation.sequence,
          intentState,
          ...(targetId ? { targetId } : {}),
          ...(workId ? { workId } : {}),
          ...(scopeId ? { scopeId } : {}),
          // definitionId only when known — never invented at runtime.
          ...(definitionId ? { definitionId } : {}),
        },
      })
      maybeEndOwnedRun()
    },

    async runInline(observation, execute) {
      if (observation.policy === 'diagnostics-only') {
        try {
          await execute()
        } catch (error) {
          // execute() restores its captured async scope only while running, so
          // re-enter the registration-time observability context for the event.
          if (observation.context) {
            observe.withContext(observation.context, () => {
              emitInternalFailure(error)
            })
          } else {
            emitInternalFailure(error)
          }
          throw error
        }
        return
      }

      const context = observation.context ?? ensurePublicContext()
      const queueDelayMs = Math.max(0, Date.now() - observation.scheduledAtMs)
      const runContext: CapturedObservabilityContext = {
        runId: context.runId,
        traceId: context.traceId,
        ...(context.startedAtMs !== undefined
          ? { startedAtMs: context.startedAtMs }
          : {}),
        ...(context.correlators !== undefined
          ? { correlators: context.correlators }
          : {}),
        spanStack: [],
      }

      await observe.withContext(runContext, async () => {
        const span = observe.openSpan({
          name: `defer run #${observation.sequence}`,
          primitive: 'defer.run',
          attributes: {
            mode: observation.mode,
            completion: observation.completion,
            sequence: observation.sequence,
            queueDelayMs,
          },
          // Execution must not open a second root when the grouped/parent run
          // already exists in the restored context.
          implicitRun: false,
        })

        if (observation.spanId) {
          observe.edge({
            edgeType: 'triggered',
            from: { kind: 'span', id: observation.spanId },
            to: { kind: 'span', id: span.spanId },
          })
        }

        try {
          await span.withContext(execute)
          span.end({
            status: 'ok',
            attributes: {
              mode: observation.mode,
              completion: observation.completion,
              sequence: observation.sequence,
              queueDelayMs,
              outcome: 'completed',
            },
          })
        } catch (error) {
          span.end({
            status: 'error',
            error,
            attributes: {
              mode: observation.mode,
              completion: observation.completion,
              sequence: observation.sequence,
              queueDelayMs,
              outcome: 'failed',
            },
          })
          throw error
        }
      })
    },

    settle(result) {
      drainSettled = true
      drainResult = result
      // Inline drain settlement must not abandon still-open named scheduled
      // spans or end the owned run while named acceptance/finalization can
      // still emit or close public evidence.
      maybeEndOwnedRun()
    },

    trackNamedLifecycle(commit) {
      namedLifecyclePending = true
      void (async () => {
        try {
          await commit
        } catch {
          // Host surfaces commit failure; evidence only needs terminal closure.
        } finally {
          namedLifecyclePending = false
          maybeEndOwnedRun()
        }
      })()
    },
  }

  function drainStatus(
    result: DeferredDrainResult,
  ): 'ok' | 'cancelled' | 'error' {
    if (result.timedOut || result.cancelled) return 'cancelled'
    if (result.callbacks.some((callback) => callback.outcome === 'failed')) {
      return 'error'
    }
    return 'ok'
  }

  function combineRunStatus(
    drain: 'ok' | 'cancelled' | 'error',
    named: 'ok' | 'cancelled' | 'error' | undefined,
  ): 'ok' | 'cancelled' | 'error' {
    if (drain === 'error' || named === 'error') return 'error'
    if (drain === 'cancelled' || named === 'cancelled') return 'cancelled'
    return 'ok'
  }

  function maybeEndOwnedRun(): void {
    if (runEnded || !ownedGroupedRun || !groupedRun) return
    if (!drainSettled || namedLifecyclePending) return
    // Safety net: any span still open after named lifecycle + drain is closed
    // as abandoned so the graph cannot stay unbalanced.
    for (const entry of openNamed.values()) {
      entry.span.end({
        status: 'cancelled',
        attributes: {
          mode: 'named',
          completion: options.completion,
          sequence: entry.sequence,
          intentState: 'abandoned',
          targetId: entry.targetId,
          workId: entry.workId,
          ...(entry.scopeId ? { scopeId: entry.scopeId } : {}),
          ...(entry.definitionId ? { definitionId: entry.definitionId } : {}),
        },
      })
      if (namedTerminalStatus !== 'error') namedTerminalStatus = 'cancelled'
    }
    openNamed.clear()

    const status = combineRunStatus(
      drainResult ? drainStatus(drainResult) : 'ok',
      namedTerminalStatus,
    )
    groupedRun.end({ status })
    runEnded = true
    ownedGroupedRun = false
    groupedRun = undefined
  }

  return api
}

/**
 * Attach one bounded failure event to the owning primitive when internal
 * composition fails. Never opens a deferred-work run or Catalog definition.
 */
function emitInternalFailure(error: unknown): void {
  const context = observe.captureContext()
  if (!context?.currentSpanId && (context?.spanStack.length ?? 0) === 0) {
    return
  }
  observe.event({
    name: 'defer.internal.failed',
    attributes: privacySafeInternalFailureAttributes(error),
  })
}

/**
 * Bounded diagnostics for internal composition failures.
 *
 * Never persist raw `error.message` or thrown strings — they can carry request
 * data, credentials, or connection strings. Preserve only already-structured
 * classification codes that look like stable machine identifiers.
 */
function privacySafeInternalFailureAttributes(
  error: unknown,
): Record<string, string> {
  const attributes: Record<string, string> = {
    message: 'Internal deferred callback failed.',
  }
  const code = extractSanitizedErrorCode(error)
  if (code) attributes.code = code
  return attributes
}

function extractSanitizedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  for (const key of ['code', 'category'] as const) {
    const value = record[key]
    if (typeof value === 'string' && isSafeDiagnosticCode(value)) {
      return value
    }
  }
  return undefined
}

/** Stable machine codes only — reject free-form or data-shaped strings. */
function isSafeDiagnosticCode(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Z][A-Z0-9_]*$/.test(value) &&
    !value.includes('=') &&
    !value.includes('://')
  )
}
