import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptedDeliveryReceipt,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { inMemoryRecordStore } from '@use-crux/core/storage'
import { resetHooks, updateHooks } from '@use-crux/core'
import { action, flow, query } from '../src/server'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS } from '../src/observability'

describe('@use-crux/convex/server', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
    vi.restoreAllMocks()
  })

  it('creates a Crux-aware action boundary with ctx.crux helpers and hidden __crux args', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const runAction = vi.fn().mockImplementation(async () => {
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:start',
          name: 'child work',
          family: 'runtime',
          primitive: 'runtime.convex.action',
        }),
      )
      return 'child-result'
    })

    const run = action({
      args: { message: 'validator-placeholder' },
      handler: async (ctx, args) => {
        expect(args).toEqual({ message: 'hello' })
        expect(ctx.crux.capture()).toMatchObject({
          runId: expect.any(String),
          traceId: expect.any(String),
        })
        return await ctx.crux.runAction('child work', 'internal.child.work', { value: args.message })
      },
    })

    await expect(
      run.handler(
        { runAction },
        {
          message: 'hello',
          __crux: {
            v: 1,
            observability: undefined,
          },
        },
      ),
    ).resolves.toBe('child-result')
    await observe.flush()

    expect(run.args).toHaveProperty('__crux')
    expect(runAction).toHaveBeenCalledWith(
      'internal.child.work',
      expect.objectContaining({
        value: 'hello',
        __crux: expect.objectContaining({
          v: 1,
          observability: expect.objectContaining({
            runId: expect.any(String),
            traceId: expect.any(String),
            currentSpanId: expect.any(String),
          }),
        }),
      }),
    )

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'child work',
        family: 'runtime',
        primitive: 'runtime.convex.action',
        attributes: expect.objectContaining({
          presentation: { display: 'detail' },
        }),
      }),
    )
  })

  it('does not create a standalone run for queries without incoming Crux context', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const getPrompt = query({
      args: { promptId: 'validator-placeholder' },
      handler: async (_ctx, args) => ({ id: args.promptId }),
    })

    await expect(getPrompt.handler({}, { promptId: 'prompt_1' })).resolves.toEqual({ id: 'prompt_1' })
    await observe.flush()

    expect(transport.records).toEqual([])
  })

  it('uses semantic standalone action metadata when no parent context exists', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const chat = action({
      observabilityName: 'chat',
      observabilityRootPrimitive: 'agent.run',
      observabilityAttributes: (args) => ({
        agentId: 'support-chat',
        sessionId: args.threadId,
      }),
      args: { threadId: 'validator-placeholder' },
      handler: async (ctx, args) => {
        expect(ctx.crux.capture()).toMatchObject({
          runId: expect.any(String),
          traceId: expect.any(String),
        })
        return args.threadId
      },
    })

    await expect(chat.handler({}, { threadId: 'thread_1' })).resolves.toBe('thread_1')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'run:start',
        name: 'chat',
        rootPrimitive: 'agent.run',
        attributes: expect.objectContaining({
          boundary: 'convex.action',
          agentId: 'support-chat',
          sessionId: 'thread_1',
        }),
      }),
    )
  })

  it('waits for the Convex default flush window before returning an action', async () => {
    const flushSpy = vi.spyOn(observe, 'flush')
    const run = action({
      args: {},
      handler: async () => 'ok',
    })

    await expect(run.handler({}, {})).resolves.toBe('ok')

    expect(flushSpy).toHaveBeenCalledWith({ timeoutMs: DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS })
  })

  it('awaits final observability delivery before a Convex action returns', async () => {
    let resolveSend!: () => void
    let sends = 0
    setObservabilityTransport({
      async send(records) {
        sends += 1
        if (sends === 1) {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
        }
        return acceptedDeliveryReceipt(records)
      },
    })
    const run = action({
      args: {},
      handler: async () => 'ok',
    })

    let returned = false
    const pending = run.handler({}, {}).then((result) => {
      returned = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(returned).toBe(false)
    resolveSend()
    await expect(pending).resolves.toBe('ok')
  })

  it('flushes and awaits Crux runAction boundary calls before returning to the caller', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const runAction = vi.fn(async () => 'child-result')
    const run = action({
      args: {},
      handler: async (ctx) => {
        return await ctx.crux.runAction('child work', 'internal.child.work', { ok: true })
      },
    })

    await expect(run.handler({ runAction }, {})).resolves.toBe('child-result')
    await observe.flush()

    expect(runAction).toHaveBeenCalledWith(
      'internal.child.work',
      expect.objectContaining({
        ok: true,
        __crux: expect.objectContaining({
          observability: expect.objectContaining({
            currentSpanId: expect.any(String),
            runId: expect.any(String),
            traceId: expect.any(String),
          }),
        }),
      }),
    )
    const childStart = transport.records.find((record) => record.type === 'span:start' && record.name === 'child work')
    expect(childStart).toMatchObject({ primitive: 'runtime.convex.action' })
    expect(childStart?.type).toBe('span:start')
    const childSpanId = childStart?.type === 'span:start' ? childStart.spanId : undefined
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: childSpanId,
        status: 'ok',
      }),
    )
  })

  it('flushes outbound action boundary completion before ctx.crux.runAction returns', async () => {
    const flushSpy = vi.spyOn(observe, 'flush')
    const runAction = vi.fn(async () => ({ status: 'completed' }))
    let childFlushes = 0
    const run = action({
      args: {},
      handler: async (ctx) => {
        const before = flushSpy.mock.calls.length
        await ctx.crux.runAction('child action', 'internal.child.action', { ok: true })
        childFlushes = flushSpy.mock.calls.length - before
        return 'ok'
      },
    })

    await expect(run.handler({ runAction }, {})).resolves.toBe('ok')

    expect(childFlushes).toBeGreaterThanOrEqual(2)
  })

  it('passes a two-sided boundary envelope and lets the child acknowledge completion on the boundary span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const child = action({
      args: { ok: 'validator-placeholder' },
      handler: async () => ({ status: 'completed', value: 'child-result' }),
    })
    const runAction = vi.fn(async (_ref, args) => child.handler({}, args as any))
    const parent = action({
      args: {},
      handler: async (ctx) => ctx.crux.runAction('child work', 'internal.child.work', { ok: true }),
    })

    await expect(parent.handler({ runAction }, {})).resolves.toMatchObject({
      status: 'completed',
      value: 'child-result',
    })
    await observe.flush()

    const boundaryStart = transport.records.find(
      (record) => record.type === 'span:start' && record.name === 'child work',
    )
    expect(boundaryStart?.type).toBe('span:start')
    const boundarySpanId = boundaryStart?.type === 'span:start' ? boundaryStart.spanId : undefined
    const childArgs = runAction.mock.calls[0]?.[1] as {
      __crux?: { boundary?: { spanId?: string; leaseExpiresAt?: string } }
    }
    expect(childArgs.__crux?.boundary).toMatchObject({
      id: boundarySpanId,
      spanId: boundarySpanId,
      kind: 'action',
      label: 'child work',
      ref: 'internal.child.work',
      parentSpanStack: expect.arrayContaining([boundarySpanId]),
      leaseExpiresAt: expect.any(String),
    })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: boundarySpanId,
        name: 'runtime.convex.boundary.requested',
        attributes: expect.objectContaining({
          boundaryId: boundarySpanId,
          boundarySpanId,
          leaseExpiresAt: childArgs.__crux?.boundary?.leaseExpiresAt,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: boundarySpanId,
        name: 'runtime.convex.boundary.received',
        attributes: expect.objectContaining({
          boundaryId: boundarySpanId,
          boundarySpanId,
          leaseExpiresAt: childArgs.__crux?.boundary?.leaseExpiresAt,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: boundarySpanId,
        name: 'runtime.convex.boundary.completed',
        attributes: expect.objectContaining({
          boundaryId: boundarySpanId,
          boundarySpanId,
          status: 'ok',
        }),
      }),
    )
  })

  it('keeps awaited action waterfalls nested and leased across every hop', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const order: string[] = []

    const grandchild = action({
      args: { from: 'validator-placeholder' },
      handler: async (_ctx, args) => ({ status: 'completed', value: `grandchild:${String(args.from)}` }),
    })
    const child = action({
      args: { ok: 'validator-placeholder' },
      handler: async (ctx, args) =>
        await ctx.crux.runAction('grandchild work', 'internal.grandchild.work', {
          from: String(args.ok),
        }),
    })
    const runAction = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      order.push(`start:${String(ref)}`)
      try {
        if (ref === 'internal.child.work') {
          return await child.handler({ runAction }, args as never)
        }
        if (ref === 'internal.grandchild.work') {
          return await grandchild.handler({}, args as never)
        }
        throw new Error(`Unexpected action ref: ${String(ref)}`)
      } finally {
        order.push(`end:${String(ref)}`)
      }
    })
    const parent = action({
      args: {},
      handler: async (ctx) => await ctx.crux.runAction('child work', 'internal.child.work', { ok: true }),
    })

    await expect(parent.handler({ runAction }, {})).resolves.toMatchObject({
      status: 'completed',
      value: 'grandchild:true',
    })
    await observe.flush()

    expect(order).toEqual([
      'start:internal.child.work',
      'start:internal.grandchild.work',
      'end:internal.grandchild.work',
      'end:internal.child.work',
    ])

    const childStart = transport.records.find((record) => record.type === 'span:start' && record.name === 'child work')
    const grandchildStart = transport.records.find(
      (record) => record.type === 'span:start' && record.name === 'grandchild work',
    )
    expect(childStart?.type).toBe('span:start')
    expect(grandchildStart?.type).toBe('span:start')
    const childSpanId = childStart?.type === 'span:start' ? childStart.spanId : undefined
    const grandchildSpanId = grandchildStart?.type === 'span:start' ? grandchildStart.spanId : undefined

    expect(grandchildStart).toMatchObject({
      parentSpanId: childSpanId,
      primitive: 'runtime.convex.action',
    })
    for (const spanId of [childSpanId, grandchildSpanId]) {
      expect(spanId).toBeDefined()
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:event',
          spanId,
          name: 'runtime.convex.boundary.requested',
          attributes: expect.objectContaining({ leaseExpiresAt: expect.any(String) }),
        }),
      )
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:event',
          spanId,
          name: 'runtime.convex.boundary.received',
        }),
      )
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:event',
          spanId,
          name: 'runtime.convex.boundary.completed',
          attributes: expect.objectContaining({ status: 'ok' }),
        }),
      )
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:end',
          spanId,
          status: 'ok',
        }),
      )
    }
  })

  it('closes and marks awaited action waterfall spans when a nested action fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const order: string[] = []

    const grandchild = action({
      args: { from: 'validator-placeholder' },
      handler: async (_ctx, args) => {
        throw new Error(`grandchild failed:${String(args.from)}`)
      },
    })
    const child = action({
      args: { ok: 'validator-placeholder' },
      handler: async (ctx, args) =>
        await ctx.crux.runAction('grandchild work', 'internal.grandchild.work', {
          from: String(args.ok),
        }),
    })
    const runAction = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      order.push(`start:${String(ref)}`)
      try {
        if (ref === 'internal.child.work') {
          return await child.handler({ runAction }, args as never)
        }
        if (ref === 'internal.grandchild.work') {
          return await grandchild.handler({}, args as never)
        }
        throw new Error(`Unexpected action ref: ${String(ref)}`)
      } finally {
        order.push(`end:${String(ref)}`)
      }
    })
    const parent = action({
      args: {},
      handler: async (ctx) => await ctx.crux.runAction('child work', 'internal.child.work', { ok: true }),
    })

    await expect(parent.handler({ runAction }, {})).rejects.toThrow('grandchild failed:true')
    await observe.flush()

    expect(order).toEqual([
      'start:internal.child.work',
      'start:internal.grandchild.work',
      'end:internal.grandchild.work',
      'end:internal.child.work',
    ])

    const rootStart = transport.records.find((record) => record.type === 'run:start')
    const childStart = transport.records.find((record) => record.type === 'span:start' && record.name === 'child work')
    const grandchildStart = transport.records.find(
      (record) => record.type === 'span:start' && record.name === 'grandchild work',
    )
    expect(rootStart?.type).toBe('run:start')
    expect(childStart?.type).toBe('span:start')
    expect(grandchildStart?.type).toBe('span:start')
    const rootRunId = rootStart?.type === 'run:start' ? rootStart.runId : undefined
    const childSpanId = childStart?.type === 'span:start' ? childStart.spanId : undefined
    const grandchildSpanId = grandchildStart?.type === 'span:start' ? grandchildStart.spanId : undefined

    expect(grandchildStart).toMatchObject({
      parentSpanId: childSpanId,
      primitive: 'runtime.convex.action',
    })
    for (const spanId of [childSpanId, grandchildSpanId]) {
      expect(spanId).toBeDefined()
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:event',
          spanId,
          name: 'runtime.convex.boundary.failed',
          attributes: expect.objectContaining({ status: 'error' }),
        }),
      )
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:end',
          spanId,
          status: 'error',
        }),
      )
    }
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'run:end',
        runId: rootRunId,
        status: 'error',
      }),
    )
  })

  it('does not propagate observability context through scheduled actions by default', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const scheduler = {
      runAfter: vi.fn(async (_delayMs: number, _ref: unknown, args: Record<string, unknown>) => args),
    }
    const parent = action({
      args: {},
      handler: async (ctx) => await ctx.crux.scheduler!.runAfter('scheduled child', 0, 'internal.child', { ok: true }),
    })

    await expect(parent.handler({ scheduler }, {})).resolves.toMatchObject({
      ok: true,
      __crux: expect.objectContaining({
        observability: undefined,
      }),
    })
    await observe.flush()

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'internal.child',
      expect.objectContaining({
        ok: true,
        __crux: expect.objectContaining({
          observability: undefined,
        }),
      }),
    )
  })

  it('defines a durable Convex flow handle with exportable action and convenience handler', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const researchFlow = flow({
      name: 'research',
      args: { question: 'validator-placeholder' },
      handler: async (scope, args) => {
        expect(args).toEqual({ question: 'What changed?' })
        return await scope.step('plan', () => `plan:${scope.input.question}`)
      },
    })

    expect(researchFlow.args).toHaveProperty('question')
    expect(researchFlow.action.args).toHaveProperty('__crux')
    await expect(researchFlow.action.handler({}, { question: 'What changed?' })).resolves.toMatchObject({
      status: 'completed',
      output: 'plan:What changed?',
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'research',
        primitive: 'flow.run',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'plan',
        primitive: 'flow.step',
      }),
    )
  })

  it('flushes direct Convex flow handler results so suspended flows are visible immediately', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({ records: inMemoryRecordStore() })
    const flushSpy = vi.spyOn(observe, 'flush')

    const reviewFlow = flow({
      name: 'review-flow',
      args: { draftId: 'validator-placeholder' },
      observabilityFlushTimeoutMs: 7,
      handler: async (scope) => {
        await scope.step('plan', () => ({ draftId: scope.input.draftId }))
        await scope.suspend('plan-approval')
        return 'approved'
      },
    })

    await expect(reviewFlow.handler({} as any, { draftId: 'draft-1' })).resolves.toMatchObject({
      status: 'suspended',
      suspendedAt: 'plan-approval',
    })

    expect(flushSpy).toHaveBeenCalledWith({ timeoutMs: 7 })
    const planStart = transport.records.find((record) => record.type === 'span:start' && record.name === 'plan')
    const flowStart = transport.records.find((record) => record.type === 'span:start' && record.name === 'review-flow')
    const planSpanId = planStart?.type === 'span:start' ? planStart.spanId : undefined
    const flowSpanId = flowStart?.type === 'span:start' ? flowStart.spanId : undefined
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: planSpanId,
        status: 'ok',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: flowSpanId,
        status: 'suspended',
      }),
    )
  })

  it('ends the action boundary while resuming the durable flow run across the scheduler hop', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({ records: inMemoryRecordStore() })

    const scheduled: Array<{ delayMs: number; ref: unknown; args: Record<string, unknown> }> = []
    const scheduler = {
      runAfter: vi.fn(async (delayMs: number, ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delayMs, ref, args })
      }),
    }

    const reviewFlow = flow({
      name: 'review-flow',
      args: { draftId: 'validator-placeholder' },
      handler: async (scope) => {
        await scope.step('draft', () => ({ draftId: scope.input.draftId }))
        await scope.suspend('approval')
        return await scope.step('publish', () => 'published')
      },
    })

    const suspended = await reviewFlow.action.handler({ scheduler }, { draftId: 'draft-1' })
    await observe.flush()

    expect(suspended).toMatchObject({ status: 'suspended', suspendedAt: 'approval' })
    if (suspended.status !== 'suspended') return

    const boundaryStart = transport.records.find(
      (record) => record.type === 'run:start' && record.rootPrimitive === 'runtime.convex.action',
    )
    const flowStart = transport.records.find(
      (record) => record.type === 'run:start' && record.rootPrimitive === 'flow.run',
    )
    const boundaryRunId = boundaryStart?.type === 'run:start' ? boundaryStart.runId : undefined
    const flowRunId = flowStart?.type === 'run:start' ? flowStart.runId : undefined
    expect(boundaryRunId).toBeDefined()
    expect(flowRunId).toBeDefined()
    expect(boundaryRunId).not.toBe(flowRunId)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        runId: flowRunId,
        status: 'suspended',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'run:suspend', runId: flowRunId, reason: 'flow.suspend' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'run:end',
        runId: boundaryRunId,
        status: 'ok',
      }),
    )
    expect(transport.records).not.toContainEqual(expect.objectContaining({ type: 'run:suspend', runId: boundaryRunId }))

    await reviewFlow.signal({ scheduler } as any, reviewFlow.action, suspended.flowId, 'approval', {})

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      reviewFlow.action,
      expect.objectContaining({ resume: suspended.flowId }),
    )

    const recordCountBeforeResume = transport.records.length
    await expect(reviewFlow.action.handler({ scheduler }, scheduled[0]!.args as any)).resolves.toMatchObject({
      status: 'completed',
      flowId: suspended.flowId,
      output: 'published',
    })
    await observe.flush()

    const resumeRecords = transport.records.slice(recordCountBeforeResume)
    expect(resumeRecords).not.toContainEqual(expect.objectContaining({ type: 'run:start', runId: flowRunId }))
    expect(resumeRecords).toContainEqual(expect.objectContaining({ type: 'run:resume', runId: flowRunId }))
    expect(resumeRecords).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        runId: flowRunId,
        name: 'review-flow',
        primitive: 'flow.run',
      }),
    )
    expect(resumeRecords).toContainEqual(expect.objectContaining({ type: 'run:end', runId: flowRunId, status: 'ok' }))
  })
})
