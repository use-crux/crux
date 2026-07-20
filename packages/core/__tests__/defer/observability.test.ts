import { afterEach, describe, expect, it, vi } from 'vitest'
import { defer } from '@use-crux/core'
import { runWithDeferInvocation } from '@use-crux/core/internal/scope'
import { durableTask } from '@use-crux/core/runtime'
import { createTestRuntime } from '@use-crux/core/runtime/testing'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from '../../src/observability'
import { expectBalancedGraph } from '../observability/helpers/expect-balanced-graph'
import { createTestScopeDeferController, testBinding } from './test-binding'
import { scheduleDiagnosticsOnlyDeferredCallback } from '../../src/defer/internal/port'

describe('public defer observability (DFR-E04)', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records scope-outcome skips without invoking the callback', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let drain: (() => Promise<void>) | undefined
    const callback = vi.fn()

    await runWithDeferInvocation(() => defer(callback), {
      binding: testBinding((run) => {
        drain = run
      }),
      classifyOutcome: () => 'error',
    })
    await drain?.()

    expect(callback).not.toHaveBeenCalled()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'cancelled',
        attributes: expect.objectContaining({
          outcome: 'cancelled',
          skipReason: 'scope-outcome',
        }),
      }),
    )
  })

  it('emits defer.scheduled then defer.run under the originating run with a causal triggered edge', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    await observe.run(
      { name: 'handler', rootPrimitive: 'custom.operation' },
      async () => {
        await runWithDeferInvocation(
          () => {
            defer(async () => {})
            return 'ok'
          },
          {
            binding: testBinding((run) => {
              scheduled = run
            }),
            classifyOutcome: () => 'success',
          },
        )
      },
    )

    expect(scheduled).toBeTypeOf('function')
    await scheduled?.()
    await observe.flush()

    const records = transport.records
    expectBalancedGraph(records)

    const scheduledStart = records.find(
      (record): record is Extract<CruxGraphRecord, { type: 'span:start' }> =>
        record.type === 'span:start' && record.primitive === 'defer.scheduled',
    )
    expect(scheduledStart).toMatchObject({
      family: 'defer',
      primitive: 'defer.scheduled',
      attributes: expect.objectContaining({
        mode: 'inline',
        sequence: 0,
      }),
    })

    const runStart = records.find(
      (record): record is Extract<CruxGraphRecord, { type: 'span:start' }> =>
        record.type === 'span:start' && record.primitive === 'defer.run',
    )
    expect(runStart).toMatchObject({
      family: 'defer',
      primitive: 'defer.run',
      parentSpanId: null,
      attributes: expect.objectContaining({
        mode: 'inline',
        sequence: 0,
      }),
    })

    expect(records).toContainEqual(
      expect.objectContaining({
        type: 'edge',
        edgeType: 'triggered',
        from: { kind: 'span', id: scheduledStart?.spanId },
        to: { kind: 'span', id: runStart?.spanId },
      }),
    )

    const originatingRun = records.find(
      (record) =>
        record.type === 'run:start' &&
        record.rootPrimitive === 'custom.operation',
    )
    expect(originatingRun).toBeDefined()
    expect(scheduledStart?.runId).toBe(
      originatingRun && 'runId' in originatingRun
        ? originatingRun.runId
        : undefined,
    )
    expect(runStart?.runId).toBe(scheduledStart?.runId)
  })

  it('creates one lightweight grouped deferred-work run when no originating Crux run exists', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    await runWithDeferInvocation(
      () => {
        defer(async () => {})
        defer(async () => {})
        return 'ok'
      },
      {
        binding: testBinding((run) => {
          scheduled = run
        }),
        classifyOutcome: () => 'success',
      },
    )

    await scheduled?.()
    await observe.flush()

    const runStarts = transport.records.filter(
      (record) => record.type === 'run:start',
    )
    expect(runStarts).toHaveLength(1)
    expect(runStarts[0]).toMatchObject({
      rootPrimitive: 'defer.scheduled',
      name: 'deferred work',
    })

    const scheduledSpans = transport.records.filter(
      (record) =>
        record.type === 'span:start' && record.primitive === 'defer.scheduled',
    )
    expect(scheduledSpans).toHaveLength(2)
    expect(new Set(scheduledSpans.map((span) => span.runId)).size).toBe(1)

    expectBalancedGraph(transport.records)
  })

  it('records contained callback failure without unbalancing the graph', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    await runWithDeferInvocation(
      () => {
        defer(async () => {
          throw new Error('callback boom')
        })
        return 'ok'
      },
      {
        binding: testBinding((run) => {
          scheduled = run
        }),
        classifyOutcome: () => 'success',
      },
    )

    await scheduled?.()
    await observe.flush()

    const runEnd = transport.records.find(
      (record) =>
        record.type === 'span:end' &&
        transport.records.some(
          (start) =>
            start.type === 'span:start' &&
            start.spanId === record.spanId &&
            start.primitive === 'defer.run',
        ),
    )
    expect(runEnd).toMatchObject({
      status: 'error',
      error: expect.objectContaining({
        category: 'DEFER_CALLBACK_FAILED',
        message: expect.stringContaining('deferred callback failed'),
      }),
    })
    expectBalancedGraph(transport.records)
  })
})

describe('internal defer composition is quiet (DFR-E03)', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('does not emit Catalog or user Run/scheduled spans for diagnostics-only scheduling', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    await observe.run(
      { name: 'owner', rootPrimitive: 'custom.operation' },
      async () => {
        await runWithDeferInvocation(
          () => {
            scheduleDiagnosticsOnlyDeferredCallback(async () => {})
            return 'ok'
          },
          {
            binding: testBinding((run) => {
              scheduled = run
            }),
            classifyOutcome: () => 'success',
          },
        )
      },
    )

    await scheduled?.()
    await observe.flush()

    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          (record.primitive === 'defer.scheduled' ||
            record.primitive === 'defer.run'),
      ),
    ).toHaveLength(0)
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'run:start' &&
          record.rootPrimitive === 'defer.scheduled',
      ),
    ).toHaveLength(0)
  })

  it('records privacy-safe diagnostics on internal callback failure', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const secretMessage =
      'password=hunter2 api_key=sk-live-abc connection=postgres://user:secret@host/db request-body=ssn:123-45-6789'

    let scheduled: (() => Promise<void>) | undefined
    await observe.run(
      { name: 'owner', rootPrimitive: 'custom.operation' },
      async () => {
        // Events attach to an owning primitive span, not a bare run.
        await observe.span(
          { name: 'owner-op', primitive: 'custom.operation' },
          async () => {
            await runWithDeferInvocation(
              () => {
                scheduleDiagnosticsOnlyDeferredCallback(async () => {
                  throw Object.assign(new Error(secretMessage), {
                    code: 'UPSTREAM_TIMEOUT',
                  })
                })
                return 'ok'
              },
              {
                binding: testBinding((run) => {
                  scheduled = run
                }),
                classifyOutcome: () => 'success',
              },
            )
          },
        )
      },
    )

    await scheduled?.()
    await observe.flush()

    const failureEvent = transport.records.find(
      (record) =>
        record.type === 'span:event' && record.name === 'defer.internal.failed',
    )
    // Contained failures are classified as DEFER_CALLBACK_FAILED; raw
    // secret-bearing messages and cause codes must not appear.
    expect(failureEvent).toMatchObject({
      attributes: {
        message: 'Internal deferred callback failed.',
        code: 'DEFER_CALLBACK_FAILED',
      },
    })
    const serialized = JSON.stringify(failureEvent)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('sk-live-abc')
    expect(serialized).not.toContain('postgres://')
    expect(serialized).not.toContain('123-45-6789')
    expect(serialized).not.toContain(secretMessage)
    expect(serialized).not.toContain('UPSTREAM_TIMEOUT')
  })

  it('does not leak free-form thrown strings into internal failure attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    await observe.run(
      { name: 'owner', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'owner-op', primitive: 'custom.operation' },
          async () => {
            await runWithDeferInvocation(
              () => {
                scheduleDiagnosticsOnlyDeferredCallback(async () => {
                  throw 'Bearer super-secret-token Authorization: yes'
                })
                return 'ok'
              },
              {
                binding: testBinding((run) => {
                  scheduled = run
                }),
                classifyOutcome: () => 'success',
              },
            )
          },
        )
      },
    )

    await scheduled?.()
    await observe.flush()

    const failureEvent = transport.records.find(
      (record) =>
        record.type === 'span:event' && record.name === 'defer.internal.failed',
    )
    expect(failureEvent).toMatchObject({
      attributes: {
        message: 'Internal deferred callback failed.',
        code: 'DEFER_CALLBACK_FAILED',
      },
    })
    const serialized = JSON.stringify(failureEvent)
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('Bearer')
  })
})

describe('named evidence lifecycle vs drain settlement', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetObservabilityRuntime()
  })

  it('keeps the grouped run open until named release when empty drain settles first', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const { createDeferScopeObservability } =
      await import('../../src/defer/internal/observability')

    const evidence = createDeferScopeObservability()
    let releaseCommit!: () => void
    const commit = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    evidence.trackNamedLifecycle(commit)

    const observation = evidence.recordNamedScheduled({
      sequence: 0,
      policy: 'public',
      targetId: 'named-evidence-release',
      workId: 'work_named_1',
      scopeId: 'scope_named_1',
      scheduledSpanId: '0000000000000001',
    })

    // Empty/fast drain settles while named commit is still pending.
    evidence.settle({ callbacks: [], timedOut: false, cancelled: false })
    await observe.flush()
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(0)
    expect(
      transport.records.filter((record) => record.type === 'span:end'),
    ).toHaveLength(0)

    evidence.markNamedTerminal(observation, 'released')
    releaseCommit()
    await commit
    await Promise.resolve()
    await observe.flush()

    expect(
      transport.records.filter((record) => record.type === 'span:end'),
    ).toContainEqual(
      expect.objectContaining({
        status: 'ok',
        attributes: expect.objectContaining({
          intentState: 'released',
          targetId: 'named-evidence-release',
          workId: 'work_named_1',
          scopeId: 'scope_named_1',
        }),
      }),
    )
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(1)
    expectBalancedGraph(transport.records)
  })

  it('never closes another nested named span when sequences collide', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const { createDeferScopeObservability } =
      await import('../../src/defer/internal/observability')

    const evidence = createDeferScopeObservability()
    // Nested callback scopes each begin their durable sequence at zero.
    const outer = evidence.recordNamedScheduled({
      sequence: 0,
      policy: 'public',
      targetId: 'outer-target',
      workId: 'outer-work',
      scheduledSpanId: '0000000000000004',
    })
    const nested = evidence.recordNamedScheduled({
      sequence: 0,
      policy: 'public',
      targetId: 'nested-target',
      workId: 'nested-work',
      scheduledSpanId: '0000000000000005',
    })

    // A terminal notification without the exact work identity is ignored;
    // sequence 0 must not select the outer span.
    evidence.markNamedTerminal(
      { ...nested, workId: 'unknown-nested-work' },
      'released',
    )
    await observe.flush()
    expect(
      transport.records.filter((record) => record.type === 'span:end'),
    ).toHaveLength(0)

    evidence.markNamedTerminal(nested, 'released')
    await observe.flush()
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' && record.spanId === nested.spanId,
      ),
    ).toHaveLength(1)
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' && record.spanId === outer.spanId,
      ),
    ).toHaveLength(0)

    evidence.markNamedTerminal(outer, 'released')
    evidence.settle({ callbacks: [], timedOut: false, cancelled: false })
    await observe.flush()
    expectBalancedGraph(transport.records)
  })

  it('ends named scheduled as abandoned after commit failure, not from empty drain', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const { createDeferScopeObservability } =
      await import('../../src/defer/internal/observability')

    const evidence = createDeferScopeObservability()
    let releaseCommit!: (error?: unknown) => void
    const commit = new Promise<void>((resolve, reject) => {
      releaseCommit = (error) => {
        if (error) reject(error)
        else resolve()
      }
    })
    evidence.trackNamedLifecycle(commit)

    const observation = evidence.recordNamedScheduled({
      sequence: 0,
      policy: 'public',
      targetId: 'named-evidence-abandon',
      workId: 'work_named_2',
      scopeId: 'scope_named_2',
      scheduledSpanId: '0000000000000002',
    })
    evidence.settle({ callbacks: [], timedOut: false, cancelled: false })
    await observe.flush()
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(0)

    evidence.markNamedTerminal(observation, 'abandoned')
    releaseCommit(new Error('forced finalize failure'))
    await commit.catch(() => undefined)
    await Promise.resolve()
    await observe.flush()

    expect(
      transport.records.filter((record) => record.type === 'span:end'),
    ).toContainEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          intentState: 'abandoned',
          targetId: 'named-evidence-abandon',
          workId: 'work_named_2',
          scopeId: 'scope_named_2',
        }),
      }),
    )
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(1)
    expectBalancedGraph(transport.records)
  })

  it('keeps the run open for late named acceptance after drain (ignored caller promise)', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const { createDeferScopeObservability } =
      await import('../../src/defer/internal/observability')

    const evidence = createDeferScopeObservability()
    let releaseCommit!: () => void
    const commit = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    evidence.trackNamedLifecycle(commit)

    // Drain finishes before the ignored stage promise accepts.
    evidence.settle({ callbacks: [], timedOut: false, cancelled: false })
    await observe.flush()
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(0)

    const observation = evidence.recordNamedScheduled({
      sequence: 0,
      policy: 'public',
      targetId: 'named-evidence-ignored',
      workId: 'work_named_3',
      scopeId: 'scope_named_3',
      scheduledSpanId: '0000000000000003',
    })
    evidence.markNamedTerminal(observation, 'released')
    releaseCommit()
    await commit
    await Promise.resolve()
    await observe.flush()

    expect(
      transport.records.some(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'defer.scheduled' &&
          record.attributes?.mode === 'named',
      ),
    ).toBe(true)
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(1)
    expectBalancedGraph(transport.records)
  })

  it('retains delivery until ignored named acceptance closes its terminal evidence', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 })

    let runRetained: (() => Promise<void>) | undefined
    const scope = createTestScopeDeferController({
      ...testBinding((run) => {
        runRetained = run
      }),
      durableFinalization: true,
    })
    let releaseAcceptance!: () => void
    const acceptanceGate = new Promise<void>((resolve) => {
      releaseAcceptance = resolve
    })
    const namedLifecycle = acceptanceGate.then(() => {
      const input = {
        sequence: 0,
        targetId: 'ignored-named-acceptance',
        workId: 'work_ignored_acceptance',
        scopeId: 'scope_ignored_acceptance',
        scheduledAtMs: Date.now(),
        scheduledSpanId: '0000000000000006',
      }
      scope.namedEvidenceHooks.onStaged(input)
      scope.namedEvidenceHooks.onTerminal([input], 'released')
    })
    scope.trackCommit(namedLifecycle)

    const barriers = scope.seal('success')
    const retained = runRetained?.()
    let retainedDone = false
    void retained?.then(() => {
      retainedDone = true
    })

    // Public callback settlement remains independent from durable acceptance.
    await expect(barriers.settled).resolves.toMatchObject({
      timedOut: false,
      cancelled: false,
    })
    expect(retainedDone).toBe(false)
    expect(transport.records).toHaveLength(0)

    releaseAcceptance()
    await barriers.committed
    await retained

    const scheduled = transport.records.find(
      (record) =>
        record.type === 'span:start' &&
        record.primitive === 'defer.scheduled' &&
        record.attributes?.targetId === 'ignored-named-acceptance',
    )
    expect(scheduled).toBeDefined()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: scheduled?.spanId,
        attributes: expect.objectContaining({ intentState: 'released' }),
      }),
    )
    expect(
      transport.records.filter((record) => record.type === 'run:end'),
    ).toHaveLength(1)
    expectBalancedGraph(transport.records)
  })

  it('resolves public settled without waiting for named commit', async () => {
    let releaseCommit!: () => void
    const hangCommit = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    let retainedDone = false
    let retained: Promise<void> | undefined
    let committedDone = false
    const binding = {
      ...testBinding(() => {}),
      durableFinalization: true,
      retain(work: () => Promise<void>) {
        retained = work()
        void retained.then(() => {
          retainedDone = true
        })
      },
    }

    const scope = createTestScopeDeferController(binding)
    // Simulate in-flight named acceptance still tracked by the commit barrier.
    scope.trackCommit(hangCommit)
    const barriers = scope.seal('success')
    void barriers.committed.then(
      () => {
        committedDone = true
      },
      () => {
        committedDone = true
      },
    )

    await expect(barriers.settled).resolves.toMatchObject({
      timedOut: false,
      cancelled: false,
    })
    expect(committedDone).toBe(false)
    expect(retainedDone).toBe(false)

    releaseCommit()
    await barriers.committed
    await retained
    expect(committedDone).toBe(true)
    expect(retainedDone).toBe(true)
  })

  it('integration: named success ends scheduled as released with a balanced graph', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const target = durableTask('named-evidence-integration', {
      run: async (input: { readonly id: string }) => input.id,
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined
      await runWithDeferInvocation(
        async () => {
          await defer(target, { id: '1' })
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      const namedEnd = transport.records.find(
        (record) =>
          record.type === 'span:end' &&
          transport.records.some(
            (start) =>
              start.type === 'span:start' &&
              start.spanId === record.spanId &&
              start.primitive === 'defer.scheduled' &&
              start.attributes?.mode === 'named',
          ),
      )
      expect(namedEnd).toMatchObject({
        status: 'ok',
        attributes: expect.objectContaining({
          intentState: 'released',
          targetId: 'named-evidence-integration',
          workId: expect.any(String),
          scopeId: expect.any(String),
        }),
      })
      expect(
        transport.records.filter((record) => record.type === 'run:end'),
      ).toHaveLength(1)
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })

  it('emits defer.run when a named deferred target actually executes', async () => {
    const transport = createInMemoryObservabilityTransport()
    const persistedStatusesAtDelivery: string[] = []
    let terminalDeliveryAttempts = 0
    let executed = false
    let workId: string | undefined
    const target = durableTask('named-run-execution', {
      run: async (input: { readonly id: string }) => {
        executed = true
        return input.id
      },
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    const accept = transport.send.bind(transport)
    setObservabilityTransport(
      {
        ...transport,
        async send(records) {
          const terminalEvidence = records.some(
            (record) =>
              record.type === 'span:end' &&
              record.attributes?.mode === 'named' &&
              record.attributes?.outcome === 'completed',
          )
          if (terminalEvidence && workId) {
            const persisted = await testRuntime.store.state.getWork(workId, {
              namespace: 'local',
            })
            persistedStatusesAtDelivery.push(persisted?.status ?? 'missing')
            terminalDeliveryAttempts += 1
            if (terminalDeliveryAttempts === 1) {
              return { dispositions: [], retryAfterMs: 1 }
            }
          }
          return accept(records)
        },
      },
      {
        scheduledDelayMs: 60_000,
        retryDelayMs: 1,
        maxRetryDelayMs: 1,
        retryJitterRatio: 0,
      },
    )
    try {
      let drain: (() => Promise<void>) | undefined
      let scheduledSpanId: string | undefined

      await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { id: 'exec-1' })
          workId = reference.workId
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      const scheduledStart = transport.records.find(
        (record): record is Extract<CruxGraphRecord, { type: 'span:start' }> =>
          record.type === 'span:start' &&
          record.primitive === 'defer.scheduled' &&
          record.attributes?.mode === 'named',
      )
      scheduledSpanId = scheduledStart?.spanId
      expect(scheduledStart).toMatchObject({
        attributes: expect.objectContaining({
          mode: 'named',
          targetId: 'named-run-execution',
          workId,
        }),
      })

      const work = await testRuntime.store.state.getWork(workId!, {
        namespace: 'local',
      })
      expect(work?.work).toMatchObject({
        kind: 'task.run',
        defer: expect.objectContaining({
          mode: 'named',
          targetId: 'named-run-execution',
          workId,
          scopeId: expect.any(String),
          sequence: 0,
          scheduledSpanId,
          operationId: scheduledStart?.operationId,
          runId: scheduledStart?.runId,
          segmentId: scheduledStart?.segmentId,
        }),
      })

      await testRuntime.settle()

      expect(executed).toBe(true)
      expect(persistedStatusesAtDelivery).toEqual(['completed', 'completed'])
      const runStart = transport.records.find(
        (record): record is Extract<CruxGraphRecord, { type: 'span:start' }> =>
          record.type === 'span:start' &&
          record.primitive === 'defer.run' &&
          record.attributes?.mode === 'named',
      )
      expect(runStart).toMatchObject({
        family: 'defer',
        primitive: 'defer.run',
        attributes: expect.objectContaining({
          mode: 'named',
          targetId: 'named-run-execution',
          workId,
          sequence: 0,
        }),
      })
      expect(runStart?.runId).not.toBe(scheduledStart?.runId)
      expect(runStart?.operationId).toBe(scheduledStart?.operationId)
      expect(runStart?.traceId).toBe(scheduledStart?.traceId)
      expect(runStart?.segmentId).not.toBe(scheduledStart?.segmentId)
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'edge',
          edgeType: 'triggered',
          from: { kind: 'span', id: scheduledSpanId },
          to: { kind: 'span', id: runStart?.spanId },
        }),
      )
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })

  it('flushes failed named wake evidence only after retry persistence', async () => {
    const transport = createInMemoryObservabilityTransport()
    const persistedStatusesAtDelivery: string[] = []
    let terminalDeliveryAttempts = 0
    let workId: string | undefined
    const target = durableTask('named-run-failure', {
      run: async () => {
        throw new Error('named target failed')
      },
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    const accept = transport.send.bind(transport)
    setObservabilityTransport(
      {
        ...transport,
        async send(records) {
          const terminalEvidence = records.some(
            (record) =>
              record.type === 'span:end' &&
              record.attributes?.mode === 'named' &&
              record.attributes?.outcome === 'failed',
          )
          if (terminalEvidence && workId) {
            const persisted = await testRuntime.store.state.getWork(workId, {
              namespace: 'local',
            })
            persistedStatusesAtDelivery.push(persisted?.status ?? 'missing')
            terminalDeliveryAttempts += 1
            if (terminalDeliveryAttempts === 1) {
              return { dispositions: [], retryAfterMs: 1 }
            }
          }
          return accept(records)
        },
      },
      {
        scheduledDelayMs: 60_000,
        retryDelayMs: 1,
        maxRetryDelayMs: 1,
        retryJitterRatio: 0,
      },
    )
    try {
      let drain: (() => Promise<void>) | undefined
      await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { id: 'failure-1' })
          workId = reference.workId
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      await testRuntime.tick()

      expect(persistedStatusesAtDelivery).toEqual(['pending', 'pending'])
      await expect(
        testRuntime.store.state.getWork(workId!, { namespace: 'local' }),
      ).resolves.toMatchObject({ status: 'pending', attempt: 2 })
      expect(
        transport.records.some(
          (record) =>
            record.type === 'span:end' &&
            record.attributes?.mode === 'named' &&
            record.attributes?.outcome === 'failed',
        ),
      ).toBe(true)
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })

  it('keeps a committed named wake authoritative when delivery hangs', async () => {
    const transport = createInMemoryObservabilityTransport()
    let terminalSendStarted = false
    const accept = transport.send.bind(transport)
    setObservabilityTransport(
      {
        ...transport,
        send(records) {
          if (
            records.some(
              (record) =>
                record.type === 'span:end' &&
                record.attributes?.mode === 'named' &&
                record.attributes?.outcome === 'completed',
            )
          ) {
            terminalSendStarted = true
            return new Promise(() => {})
          }
          return accept(records)
        },
      },
      { scheduledDelayMs: 60_000 },
    )
    const target = durableTask('named-run-hung-delivery', {
      run: async () => undefined,
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined
      let workId: string | undefined
      await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { id: 'hung-1' })
          workId = reference.workId
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      vi.useFakeTimers()
      const wake = testRuntime.tick()
      await vi.advanceTimersByTimeAsync(3_001)
      await expect(wake).resolves.toBeDefined()

      expect(terminalSendStarted).toBe(true)
      await expect(
        testRuntime.store.state.getWork(workId!, { namespace: 'local' }),
      ).resolves.toMatchObject({ status: 'completed' })
    } finally {
      testRuntime.dispose()
    }
  })

  it('reconstructs async named defer.run causality from persisted scheduledSpanId', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let executed = false
    const target = durableTask('named-run-reconstruct', {
      run: async (input: { readonly id: string }) => {
        executed = true
        return input.id
      },
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined
      let workId: string | undefined

      await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { id: 'reconstruct-1' })
          workId = reference.workId
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      const scheduledStart = transport.records.find(
        (record): record is Extract<CruxGraphRecord, { type: 'span:start' }> =>
          record.type === 'span:start' &&
          record.primitive === 'defer.scheduled' &&
          record.attributes?.mode === 'named',
      )
      expect(scheduledStart?.spanId).toEqual(expect.any(String))

      const work = await testRuntime.store.state.getWork(workId!, {
        namespace: 'local',
      })
      expect(work?.work).toMatchObject({
        kind: 'task.run',
        defer: expect.objectContaining({
          scheduledSpanId: scheduledStart?.spanId,
          operationId: scheduledStart?.operationId,
          runId: scheduledStart?.runId,
          traceId: scheduledStart?.traceId,
          segmentId: scheduledStart?.segmentId,
          workId,
        }),
      })

      // Durable work can execute after the originating grouped run has ended.
      expect(
        transport.records.filter((record) => record.type === 'run:end'),
      ).toHaveLength(1)

      await testRuntime.settle()
      await observe.flush()

      expect(executed).toBe(true)
      const runStarts = transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'defer.run' &&
          record.attributes?.mode === 'named',
      )
      expect(runStarts).toHaveLength(1)
      const runStart = runStarts[0]!
      expect(runStart.runId).not.toBe(scheduledStart?.runId)
      expect(runStart.operationId).toBe(scheduledStart?.operationId)
      expect(runStart.traceId).toBe(scheduledStart?.traceId)
      expect(runStart.segmentId).not.toBe(scheduledStart?.segmentId)
      const executionRunStartIndex = transport.records.findIndex(
        (record) =>
          record.type === 'run:start' && record.runId === runStart.runId,
      )
      const executionRunEndIndex = transport.records.findIndex(
        (record) =>
          record.type === 'run:end' && record.runId === runStart.runId,
      )
      expect(executionRunStartIndex).toBeLessThan(
        transport.records.indexOf(runStart),
      )
      expect(executionRunEndIndex).toBeGreaterThan(
        transport.records.indexOf(runStart),
      )
      expect(transport.records[executionRunStartIndex]).toMatchObject({
        operationId: scheduledStart?.operationId,
        parentRunId: scheduledStart?.runId,
        triggeredBySpanId: scheduledStart?.spanId,
      })
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'edge',
          edgeType: 'triggered',
          from: { kind: 'span', id: scheduledStart?.spanId },
          to: { kind: 'span', id: runStart.spanId },
        }),
      )
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })

  it('emits public named evidence for nested defer(target) inside an inline callback', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let executed = false
    const target = durableTask('nested-callback-named', {
      run: async (input: { readonly id: string }) => {
        executed = true
        return input.id
      },
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined
      let workId: string | undefined

      await runWithDeferInvocation(
        async () => {
          defer(async () => {
            const reference = await defer(target, { id: 'nested-1' })
            workId = reference.workId
          })
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      const namedScheduled = transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'defer.scheduled' &&
          record.attributes?.mode === 'named',
      )
      expect(namedScheduled).toHaveLength(1)
      expect(namedScheduled[0]).toMatchObject({
        attributes: expect.objectContaining({
          targetId: 'nested-callback-named',
          workId,
        }),
      })

      const inlineScheduled = transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'defer.scheduled' &&
          record.attributes?.mode === 'inline',
      )
      expect(inlineScheduled).toHaveLength(1)
      expect(namedScheduled[0]?.runId).toBe(inlineScheduled[0]?.runId)

      const work = await testRuntime.store.state.getWork(workId!, {
        namespace: 'local',
      })
      expect(work?.work).toMatchObject({
        kind: 'task.run',
        defer: expect.objectContaining({
          scheduledSpanId: namedScheduled[0]?.spanId,
          workId,
        }),
      })

      await testRuntime.settle()
      await observe.flush()

      expect(executed).toBe(true)
      const namedRun = transport.records.find(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'defer.run' &&
          record.attributes?.mode === 'named',
      )
      expect(namedRun).toMatchObject({
        traceId: namedScheduled[0]?.traceId,
        attributes: expect.objectContaining({
          targetId: 'nested-callback-named',
          workId,
        }),
      })
      expect(namedRun?.runId).not.toBe(namedScheduled[0]?.runId)
      expect(namedRun?.segmentId).not.toBe(namedScheduled[0]?.segmentId)
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'edge',
          edgeType: 'triggered',
          from: { kind: 'span', id: namedScheduled[0]?.spanId },
          to: { kind: 'span', id: namedRun?.spanId },
        }),
      )
      // Durable execution owns a fresh run on the same trace.
      expect(
        transport.records.filter((record) => record.type === 'run:start'),
      ).toHaveLength(2)
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })

  it('abandons nested named scheduled when nested registration commit fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const target = durableTask('nested-callback-fail', {
      run: async (input: { readonly id: string }) => input.id,
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined

      await runWithDeferInvocation(
        async () => {
          defer(async () => {
            // First stage accepts; second stage rejects (missing input) so the
            // child commit barrier fails and abandons already-staged siblings.
            await defer(target, { id: 'will-abandon' })
            await defer(target, undefined as unknown as { id: string })
          })
          return 'ok'
        },
        {
          binding: {
            ...testBinding((run) => {
              drain = run
            }),
            durableFinalization: true,
          },
          classifyOutcome: () => 'success',
        },
      )
      await drain?.()
      await observe.flush()

      const namedEnds = transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          transport.records.some(
            (start) =>
              start.type === 'span:start' &&
              start.spanId === record.spanId &&
              start.primitive === 'defer.scheduled' &&
              start.attributes?.mode === 'named',
          ),
      )
      expect(namedEnds).toHaveLength(1)
      expect(namedEnds[0]).toMatchObject({
        status: 'cancelled',
        attributes: expect.objectContaining({
          intentState: 'abandoned',
          targetId: 'nested-callback-fail',
          workId: expect.any(String),
          scopeId: expect.any(String),
        }),
      })
      expect(
        transport.records.some(
          (record) =>
            record.type === 'span:start' &&
            record.primitive === 'defer.run' &&
            record.attributes?.mode === 'named',
        ),
      ).toBe(false)
      expectBalancedGraph(transport.records)
    } finally {
      testRuntime.dispose()
    }
  })
})
