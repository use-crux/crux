import { afterEach, describe, expect, it, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { prompt as makePrompt } from '@use-crux/core'
import { agent as makeAgent } from '@use-crux/core/agent'
import {
  acceptedDeliveryReceipt,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxDeliveryReceipt,
} from '@use-crux/core/observability'
import { action, flow } from '../src/server'
import { createComponentSwarm } from '../src/swarm'
import type { ComponentApi } from '../src/component/_generated/component'
import schema from '../src/component/schema'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS, flushObservability } from '../src/observability'

const modules = {
  '../src/component/_generated/server.ts': () => import('../src/component/_generated/server'),
  '../src/component/swarm.ts': () => import('../src/component/swarm'),
} satisfies Record<string, () => Promise<unknown>>

function componentRef(): ComponentApi {
  return {
    swarm: {
      saveState: mutationRef('swarm:saveState'),
      getState: queryRef('swarm:getState'),
      listRuns: queryRef('swarm:listRuns'),
    },
  } as unknown as ComponentApi
}

function mutationRef<TArgs extends Record<string, unknown>, TResult>(path: string): FunctionReference<'mutation', 'public', TArgs, TResult> {
  return makeFunctionReference<'mutation', TArgs, TResult>(path)
}

function queryRef<TArgs extends Record<string, unknown>, TResult>(path: string): FunctionReference<'query', 'public', TArgs, TResult> {
  return makeFunctionReference<'query', TArgs, TResult>(path)
}

const triagePrompt = makePrompt({ id: 'observability-runtime-triage', system: 'Triage agent' })
const billingPrompt = makePrompt({ id: 'observability-runtime-billing', system: 'Billing agent' })
const triage = makeAgent({
  id: 'triage',
  description: 'Routes tickets',
  prompt: triagePrompt,
  handoffs: ['billing'],
})
const billing = makeAgent({
  id: 'billing',
  description: 'Handles billing',
  prompt: billingPrompt,
  handoffs: ['triage'],
})

/** Mock generate that hands off from triage to billing, then completes. */
function createMockGenerate(behavior: Record<string, { text: string } | { handoffTo: string; reason: string }>) {
  return async (prompt: { id?: string }, options: { input: unknown; tools?: Record<string, { execute?: (args: unknown) => Promise<unknown> }> }) => {
    const agentId = prompt?.id === 'observability-runtime-triage' ? 'triage' : prompt?.id === 'observability-runtime-billing' ? 'billing' : 'unknown'
    const action = behavior[agentId]
    if (action && 'handoffTo' in action) {
      const toolName = `transfer_to_${action.handoffTo}`
      await options.tools?.[toolName]?.execute?.({ reason: action.reason, context: 'test context' })
      return { text: `Transferring to ${action.handoffTo}` }
    }
    return { text: action && 'text' in action ? action.text : 'done' }
  }
}

describe('@use-crux/convex observability runtime binding (Phase 8)', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

  describe('short bounded flush budget', () => {
    it('uses a short bounded default, not the prior 20-second window', () => {
      expect(DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(5000)
      expect(DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS).not.toBe(20_000)
    })

    it('binds a Convex action boundary flush to the short default', async () => {
      const flushSpy = vi.spyOn(observe, 'flush')
      const run = action({ args: {}, handler: async () => 'ok' })

      await expect(run.handler({}, {})).resolves.toBe('ok')

      expect(flushSpy).toHaveBeenCalledWith({ timeoutMs: DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS })
    })
  })

  describe('structured drain inspection', () => {
    it('propagates the structured drain result to an explicit onDrain callback instead of a boolean', async () => {
      setObservabilityTransport(createInMemoryObservabilityTransport())
      const onDrain = vi.fn()

      const result = await flushObservability({ onDrain })

      expect(onDrain).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.any(String),
          delivered: expect.any(Number),
          rejected: expect.any(Number),
          remaining: expect.any(Number),
          deadlineExceeded: expect.any(Boolean),
        }),
      )
      expect(result).toBe(onDrain.mock.calls[0]![0])
    })

    it('warns instead of silently discarding an incomplete drain when no onDrain is supplied', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let resolveSend!: () => void
      setObservabilityTransport({
        async send(records) {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
          return acceptedDeliveryReceipt(records)
        },
      })
      const span = observe.openSpan({ name: 'observability-runtime-test', primitive: 'custom.operation' })
      span.withContext(() => observe.event({ name: 'observability-runtime-test.event' }))

      const result = await flushObservability({ timeoutMs: 5 })

      expect(result.status).toBe('deadline')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('did not fully complete'),
        expect.objectContaining({ status: 'deadline' }),
      )
      resolveSend()
    })

    it('does not warn on an incomplete opportunistic (terminal: false) mid-operation flush', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let resolveSend!: () => void
      setObservabilityTransport({
        async send(records) {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
          return acceptedDeliveryReceipt(records)
        },
      })
      const span = observe.openSpan({ name: 'observability-runtime-opportunistic', primitive: 'custom.operation' })
      span.withContext(() => observe.event({ name: 'observability-runtime-opportunistic.event' }))

      const result = await flushObservability({ timeoutMs: 5, terminal: false })

      expect(result.status).toBe('deadline')
      expect(warnSpy).not.toHaveBeenCalled()
      resolveSend()
    })

    it('still reports an incomplete opportunistic flush to an explicit onDrain callback', async () => {
      let resolveSend!: () => void
      setObservabilityTransport({
        async send(records) {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
          return acceptedDeliveryReceipt(records)
        },
      })
      const span = observe.openSpan({ name: 'observability-runtime-opportunistic-ondrain', primitive: 'custom.operation' })
      span.withContext(() => observe.event({ name: 'observability-runtime-opportunistic-ondrain.event' }))
      const onDrain = vi.fn()

      const result = await flushObservability({ timeoutMs: 5, terminal: false, onDrain })

      expect(result.status).toBe('deadline')
      expect(onDrain).toHaveBeenCalledWith(expect.objectContaining({ status: 'deadline' }))
      resolveSend()
    })

    it('reports partial delivery (mixed accept/reject) through the structured result rather than a plain boolean', async () => {
      setObservabilityTransport({
        send(records): CruxDeliveryReceipt {
          const [first, ...rest] = records
          return {
            dispositions: [
              ...(first
                ? [{ index: 0, recordId: first.recordId, outcome: 'accepted' as const, code: 'accepted', retryable: false as const }]
                : []),
              ...rest.map((record, i) => ({
                index: i + 1,
                recordId: record.recordId,
                outcome: 'rejected' as const,
                code: 'poison_record',
                retryable: false,
              })),
            ],
          }
        },
      })
      const span = observe.openSpan({ name: 'observability-runtime-partial', primitive: 'custom.operation' })
      span.withContext(() => {
        observe.event({ name: 'first' })
        observe.event({ name: 'second' })
      })

      const result = await flushObservability()

      expect(result.status).toBe('drained')
      expect(result.delivered).toBeGreaterThanOrEqual(1)
      expect(result.rejected).toBeGreaterThanOrEqual(1)
    })
  })

  describe('fresh-invocation segment resume', () => {
    // Direct in-process runtime-reset case: `resetObservabilityRuntime()` only
    // clears in-memory engine/context state within the same JS module instance
    // — it does not exercise a real Convex durable boundary (no db round-trip,
    // no separate scheduled invocation). It is retained as a fast, focused
    // unit check of `resumeRun()`'s own contract, not as proof that a carrier
    // survives a genuine Convex boundary; see the convex-test case below for
    // that proof.
    it('resumeRun() reopens the same logical run in a fresh segment given only a carrier value (unit-level, not a Convex boundary proof)', async () => {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)

      const openedRun = observe.openRun({ name: 'convex-carrier-run', rootPrimitive: 'runtime.convex.action' })
      const carrier = openedRun.suspend({ reason: 'convex.boundary.suspend' })
      const { runId, segmentId: firstSegmentId } = openedRun
      await flushObservability()

      // Simulate a fresh invocation's in-memory state, not a Convex boundary.
      resetObservabilityRuntime()
      setObservabilityTransport(transport)

      const resumedRun = observe.resumeRun(carrier, { reason: 'convex.boundary.resume' })
      expect(resumedRun.runId).toBe(runId)
      expect(resumedRun.segmentId).not.toBe(firstSegmentId)
      resumedRun.end({ status: 'ok' })
      await flushObservability()

      expect(transport.records).toContainEqual(expect.objectContaining({ type: 'run:suspend', runId }))
      expect(transport.records).toContainEqual(
        expect.objectContaining({ type: 'run:resume', runId, segmentId: resumedRun.segmentId }),
      )
      expect(transport.records).toContainEqual(expect.objectContaining({ type: 'run:end', runId, status: 'ok' }))
    })

    it('rejects a hostile/malformed carrier instead of resuming an arbitrary run', async () => {
      setObservabilityTransport(createInMemoryObservabilityTransport())
      expect(() =>
        observe.resumeRun({ crux: { runId: '' } } as never, { reason: 'convex.boundary.resume' }),
      ).toThrow()
    })

    it('carries the suspended run through a real Convex durable boundary: saved via convex-test, read back by the next scheduled swarm.resume() invocation', async () => {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)
      const t = convexTest({ schema, modules })
      const component = componentRef()
      const scheduled: Array<{ delayMs: number; ref: unknown; args: Record<string, unknown> }> = []
      const ctx = {
        runMutation: async (ref: unknown, args: Record<string, unknown>) =>
          t.mutation(ref as FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>, args),
        runQuery: async (ref: unknown, args: Record<string, unknown>) =>
          t.query(ref as FunctionReference<'query', 'public', Record<string, unknown>, unknown>, args),
        scheduler: {
          runAfter: async (delayMs: number, ref: unknown, args: Record<string, unknown>) => {
            scheduled.push({ delayMs, ref, args })
          },
        },
      }
      const swarm = createComponentSwarm({
        component,
        generate: createMockGenerate({
          triage: { handoffTo: 'billing', reason: 'billing issue' },
          billing: { text: 'billing resolved' },
        }) as never,
      })

      // Invocation 1: the physical action boundary starts the swarm, which
      // hands off and suspends its own logical run. The carrier is written
      // into a real Convex table (`swarmRuns.observability`, `v.optional(v.any())`)
      // via `t.mutation`, proving it is a Convex-valid serializable value, not
      // just an in-process JS object.
      const actionRun1 = observe.openRun({ name: 'convex action 1', rootPrimitive: 'runtime.convex.action' })
      const { swarmRunId } = await actionRun1.withContext(() =>
        swarm.start(ctx as never, {
          agents: { triage, billing },
          startAgent: 'triage',
          input: { message: 'help' },
          resumeAction: 'action:resume',
        }),
      )
      actionRun1.end()
      expect(scheduled).toHaveLength(1)
      const swarmStart = transport.records.find(
        (record) => record.type === 'run:start' && record.rootPrimitive === 'composition.swarm',
      )
      const runId = swarmStart?.type === 'run:start' ? swarmStart.runId : undefined
      expect(runId).toBeDefined()
      expect(transport.records).toContainEqual(expect.objectContaining({ type: 'run:suspend', runId }))

      // Simulate the next scheduled Convex invocation: a brand-new process
      // with zero shared JS state. Only the durable row (read through
      // `ctx.runQuery` against the real Convex db, per `scheduled[0].args`)
      // and the action arguments cross this boundary.
      resetObservabilityRuntime()
      setObservabilityTransport(transport)
      const actionRun2 = observe.openRun({ name: 'convex action 2', rootPrimitive: 'runtime.convex.action' })
      const finalState = await actionRun2.withContext(() =>
        swarm.resume(ctx as never, scheduled[0]!.args.swarmRunId as string, {
          agents: { triage, billing },
          resumeAction: 'action:resume',
        }),
      )
      actionRun2.end()

      expect(swarmRunId).toBe(scheduled[0]!.args.swarmRunId)
      expect(finalState!.status).toBe('completed')
      expect(finalState!.output).toBe('billing resolved')
      const resumeRecord = transport.records.find((record) => record.type === 'run:resume' && record.runId === runId)
      expect(resumeRecord).toBeDefined()
      expect(resumeRecord && 'segmentId' in resumeRecord ? resumeRecord.segmentId : undefined).not.toBe(
        swarmStart && 'segmentId' in swarmStart ? swarmStart.segmentId : undefined,
      )
      expect(transport.records).toContainEqual(expect.objectContaining({ type: 'run:end', runId, status: 'ok' }))
    })
  })

  describe('concurrent invocation isolation', () => {
    it('keeps two concurrent Convex action invocations from leaking observability context into each other', async () => {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)
      const seenRunIds: string[] = []

      const run = action({
        args: {},
        handler: async (ctx) => {
          const captured = ctx.crux.capture()
          seenRunIds.push(captured!.runId)
          await new Promise((resolve) => setTimeout(resolve, 1))
          expect(ctx.crux.capture()!.runId).toBe(captured!.runId)
          return captured!.runId
        },
      })

      const [a, b] = await Promise.all([run.handler({}, {}), run.handler({}, {})])

      expect(a).not.toBe(b)
      expect(new Set(seenRunIds).size).toBe(2)
    })
  })

  describe('no timer dependence', () => {
    it('completes a flush without advancing fake timers when the transport settles on a microtask', async () => {
      vi.useFakeTimers()
      try {
        setObservabilityTransport({
          async send(records) {
            return acceptedDeliveryReceipt(records)
          },
        })
        const span = observe.openSpan({ name: 'observability-runtime-notimer', primitive: 'custom.operation' })
        span.withContext(() => observe.event({ name: 'no-timer-dependence' }))

        const result = await flushObservability()

        expect(result.status).toBe('drained')
        expect(result.remaining).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('flow suspension across a Convex boundary uses the short bounded budget', () => {
    it('does not fall back to the removed 20-second default for direct flow handler flushes', async () => {
      const flushSpy = vi.spyOn(observe, 'flush')
      const reviewFlow = flow({
        name: 'observability-runtime-flow',
        args: {},
        handler: async (scope) => {
          await scope.step('plan', () => 'planned')
          return 'ok'
        },
      })

      await expect(reviewFlow.handler({} as never, {})).resolves.toMatchObject({ status: 'completed' })

      expect(flushSpy).not.toHaveBeenCalledWith({ timeoutMs: 20_000 })
    })
  })
})
