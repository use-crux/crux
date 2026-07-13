import { afterEach, describe, expect, it, vi } from 'vitest'
import { defer } from '@use-crux/core'
import {
  runWithDeferInvocation,
  type DeferLifetimeCapability,
} from '@use-crux/core/internal/defer-host'
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
import { testLifetime } from './test-lifetime'
import { scheduleDiagnosticsOnlyDeferredCallback } from '../../src/defer/internal/port'

describe('public defer observability (DFR-E04)', () => {
  afterEach(() => {
    resetObservabilityRuntime()
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
            lifetime: testLifetime((run) => {
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
        completion: 'handler-returned',
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
        completion: 'handler-returned',
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
        lifetime: testLifetime((run) => {
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
        lifetime: testLifetime((run) => {
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
            lifetime: testLifetime((run) => {
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
                lifetime: testLifetime((run) => {
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
                lifetime: testLifetime((run) => {
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

describe('handler-returned completion class is recorded', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('stamps completion on scheduled and run attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let scheduled: (() => Promise<void>) | undefined
    const lifetime: DeferLifetimeCapability = {
      ...testLifetime((run) => {
        scheduled = run
      }),
      completion: 'response-finished',
    }

    await runWithDeferInvocation(
      () => {
        defer(() => {})
        return 'ok'
      },
      {
        lifetime,
        classifyOutcome: () => 'success',
      },
    )
    await scheduled?.()
    await observe.flush()

    for (const primitive of ['defer.scheduled', 'defer.run'] as const) {
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:start',
          primitive,
          attributes: expect.objectContaining({
            completion: 'response-finished',
          }),
        }),
      )
    }
  })
})

describe('named evidence lifecycle vs drain settlement', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('keeps the grouped run open until named release when empty drain settles first', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const { createDeferScopeObservability } =
      await import('../../src/defer/internal/observability')

    const evidence = createDeferScopeObservability({
      completion: 'handler-returned',
    })
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

    const evidence = createDeferScopeObservability({
      completion: 'handler-returned',
    })
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

    const evidence = createDeferScopeObservability({
      completion: 'handler-returned',
    })
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

    const evidence = createDeferScopeObservability({
      completion: 'handler-returned',
    })
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

  it('resolves public settled without waiting for named commit', async () => {
    let releaseCommit!: () => void
    const hangCommit = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    let settledDone = false
    let committedDone = false
    const lifetime: DeferLifetimeCapability = {
      ...testLifetime(() => {}),
      durableFinalization: true,
      schedule(task) {
        void task.run().then(() => {
          settledDone = true
        })
      },
    }

    const { createInvocationDeferScope } =
      await import('../../src/defer/internal/invocation-scope')

    const scope = createInvocationDeferScope(lifetime)
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

    await vi.waitFor(() => {
      expect(settledDone).toBe(true)
    })
    expect(committedDone).toBe(false)
    await expect(barriers.settled).resolves.toMatchObject({
      timedOut: false,
      cancelled: false,
    })
    expect(committedDone).toBe(false)

    releaseCommit()
    await barriers.committed
    expect(committedDone).toBe(true)
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
          lifetime: {
            ...testLifetime((run) => {
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
    setObservabilityTransport(transport)

    let executed = false
    const target = durableTask('named-run-execution', {
      run: async (input: { readonly id: string }) => {
        executed = true
        return input.id
      },
    })
    const testRuntime = createTestRuntime({ targets: [target] })
    try {
      let drain: (() => Promise<void>) | undefined
      let workId: string | undefined
      let scheduledSpanId: string | undefined

      await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { id: 'exec-1' })
          workId = reference.workId
          return 'ok'
        },
        {
          lifetime: {
            ...testLifetime((run) => {
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
        }),
      })

      await testRuntime.settle()
      await observe.flush()

      expect(executed).toBe(true)
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
      expect(runStart?.runId).toBe(scheduledStart?.runId)
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
          lifetime: {
            ...testLifetime((run) => {
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
          runId: scheduledStart?.runId,
          traceId: scheduledStart?.traceId,
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
      expect(runStart.runId).toBe(scheduledStart?.runId)
      expect(runStart.traceId).toBe(scheduledStart?.traceId)
      expect(
        transport.records.findIndex(
          (record) =>
            record.type === 'run:end' && record.runId === runStart.runId,
        ),
      ).toBeLessThan(transport.records.indexOf(runStart))
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
          lifetime: {
            ...testLifetime((run) => {
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
        runId: namedScheduled[0]?.runId,
        attributes: expect.objectContaining({
          targetId: 'nested-callback-named',
          workId,
        }),
      })
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'edge',
          edgeType: 'triggered',
          from: { kind: 'span', id: namedScheduled[0]?.spanId },
          to: { kind: 'span', id: namedRun?.spanId },
        }),
      )
      // One owned/originating grouped run only (no duplicate nested roots).
      expect(
        transport.records.filter((record) => record.type === 'run:start'),
      ).toHaveLength(1)
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
          lifetime: {
            ...testLifetime((run) => {
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
