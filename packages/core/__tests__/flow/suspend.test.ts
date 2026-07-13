import { describe, it, expect, afterEach } from 'vitest'
import { flow as makeFlow, signalFlow, listFlows } from '../../src/flow/scope'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { RecordStore } from '../../src/storage'
import { z } from 'zod'

let store: RecordStore

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

function setupStore() {
  store = inMemoryRecordStore()
  updateHooks({ records: store })
  return store
}

// The flow body — reused across suspend and resume calls
function pipelineFlow(stepsExecuted: string[]) {
  return async (flow: { flowId: string; step: any; suspend: any }) => {
    const plan = await flow.step('plan', async () => {
      stepsExecuted.push('plan')
      return { planId: 'abc' }
    })

    await flow.suspend('approval')

    const result = await flow.step('execute', async () => {
      stepsExecuted.push('execute')
      return { result: 'done', planId: plan.planId }
    })

    return result
  }
}

describe('flow suspend', () => {
  it('suspends at a named suspend point and returns suspended status', async () => {
    setupStore()
    const stepsExecuted: string[] = []

    const run = await makeFlow('pipeline', pipelineFlow(stepsExecuted)).run()

    expect(run.status).toBe('suspended')
    expect(run.flowId).toBeTruthy()
    if (run.status === 'suspended') {
      expect(run.suspendedAt).toBe('approval')
    }

    // Only the step before suspend should have executed
    expect(stepsExecuted).toEqual(['plan'])

    // State should be persisted in the store
    const snapshot = await store.get(`crux:flow:${run.flowId}`)
    expect(snapshot).toBeTruthy()
    expect(snapshot?.status).toBe('suspended')
    expect(snapshot?.suspendedAt).toBe('approval')
  })
})

describe('flow signal + resume', () => {
  it('suspends a run segment and resumes the same run in a fresh segment', async () => {
    setupStore()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const reviewFlow = makeFlow('observable-review', async (scope) => {
      await scope.step('draft', () => ({ id: 'draft-1' }))
      await scope.suspend('approval')
      return await scope.step('publish', () => 'published')
    })

    const suspended = await reviewFlow.run()
    await observe.flush()

    expect(suspended.status).toBe('suspended')
    if (suspended.status !== 'suspended') return

    const suspendedRunStart = transport.records.find((record) => record.type === 'run:start')
    expect(suspendedRunStart).toMatchObject({ type: 'run:start' })
    const runId = suspendedRunStart?.type === 'run:start' ? suspendedRunStart.runId : undefined
    expect(runId).toBeDefined()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        runId,
        status: 'suspended',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        runId,
        primitive: 'flow.suspension',
        name: 'approval',
        attributes: expect.objectContaining({ suspendPoint: 'approval' }),
      }),
    )
    const suspensionStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'flow.suspension' && record.name === 'approval',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        runId,
        spanId: suspensionStart?.type === 'span:start' ? suspensionStart.spanId : undefined,
        status: 'suspended',
      }),
    )
    const suspendRecord = transport.records.find(
      (record) => record.type === 'run:suspend' && record.runId === runId,
    )
    expect(suspendRecord).toMatchObject({
      type: 'run:suspend',
      runId,
      reason: 'flow.suspend',
    })
    expect(transport.records).not.toContainEqual(
      expect.objectContaining({ type: 'run:end', runId }),
    )

    const snapshot = await store.get(`crux:flow:${suspended.flowId}`)
    expect(snapshot?.continuation).toEqual(
      expect.objectContaining({
        crux: expect.objectContaining({ runId, previousSegmentId: suspendRecord?.segmentId }),
      }),
    )

    // A fresh invocation has no in-memory lifecycle registry or active context.
    resetObservabilityRuntime()
    setObservabilityTransport(transport)
    const recordCountAfterSuspend = transport.records.length
    await signalFlow(suspended.flowId, 'approval', {})
    const completed = await reviewFlow.resume(suspended.flowId)
    await observe.flush()

    expect(completed).toMatchObject({ status: 'completed', flowId: suspended.flowId })
    const recordsAfterResume = transport.records.slice(recordCountAfterSuspend)
    expect(recordsAfterResume).toContainEqual(
      expect.objectContaining({
        type: 'run:resume',
        runId,
        previousSegmentId: suspendRecord?.segmentId,
      }),
    )
    const resumeRecord = recordsAfterResume.find(
      (record) => record.type === 'run:resume' && record.runId === runId,
    )
    expect(resumeRecord?.segmentId).not.toBe(suspendRecord?.segmentId)
    expect(recordsAfterResume).toContainEqual(
      expect.objectContaining({ type: 'run:end', runId, status: 'ok' }),
    )
    expect(transport.records.filter((record) => record.type === 'run:end' && record.runId === runId)).toHaveLength(1)
  })

    it('resumes a suspended flow, skips cached steps, and continues to completion', async () => {
    setupStore()
    const stepsExecuted: string[] = []
    const flowFn = pipelineFlow(stepsExecuted)
    const pipeFlow = makeFlow('pipeline', flowFn)

    // First call — suspends
    const suspended = await pipeFlow.run()
    expect(suspended.status).toBe('suspended')

    // Signal the flow
    await signalFlow(suspended.flowId, 'approval', { approvedBy: 'henri' })

    // Resume — should skip 'plan' step and execute 'execute' step
    stepsExecuted.length = 0
    const resumed = await pipeFlow.resume(suspended.flowId)

    expect(resumed.status).toBe('completed')
    if (resumed.status === 'completed') {
      expect(resumed.output).toEqual({ result: 'done', planId: 'abc' })
    }

    // 'plan' was NOT re-executed (skip-replay), 'execute' WAS run
    expect(stepsExecuted).toEqual(['execute'])
  })

    it('uses the same flowId across suspend/resume cycles', async () => {
    setupStore()
    const stepsExecuted: string[] = []
    const flowFn = pipelineFlow(stepsExecuted)
    const pipeFlow = makeFlow('pipeline', flowFn)

    const suspended = await pipeFlow.run()
    await signalFlow(suspended.flowId, 'approval')

    const resumed = await pipeFlow.resume(suspended.flowId)

    expect(resumed.flowId).toBe(suspended.flowId)
  })
})

describe('flow completed (no suspend)', () => {
  it('returns completed status with output for non-suspendable flows', async () => {
    const run = await makeFlow('simple', async (flow) => {
      return flow.step('compute', async () => 42)
    }).run()

    expect(run.status).toBe('completed')
    if (run.status === 'completed') {
      expect(run.output).toBe(42)
    }
    expect(run.flowId).toBeTruthy()
  })
})

describe('flow suspend with typed signal payload', () => {
  it('returns typed signal payload on resume', async () => {
    setupStore()

    const approvalSchema = z.object({
      approvedBy: z.string(),
      comments: z.string().optional(),
    })

    const flowFn = async (flow: { flowId: string; step: any; suspend: any }) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))

      const approval = await flow.suspend('review', {
        schema: approvalSchema,
      })

      return approval
    }

    const reviewFlow = makeFlow('review-flow', flowFn)

    // Suspend
    const suspended = await reviewFlow.run()
    expect(suspended.status).toBe('suspended')

    // Signal with typed payload
    await signalFlow(suspended.flowId, 'review', {
      approvedBy: 'henri',
      comments: 'Looks good!',
    })

    // Resume — approval should contain the signal payload
    const resumed = await reviewFlow.resume(suspended.flowId)
    expect(resumed.status).toBe('completed')
    if (resumed.status === 'completed') {
      expect(resumed.output).toEqual({
        approvedBy: 'henri',
        comments: 'Looks good!',
      })
    }
  })
})

describe('flow suspend error handling', () => {
  it('throws clear error when suspend is called without a store', async () => {
    // No store configured
    resetHooks()

    await expect(
      makeFlow('no-store', async (flow) => {
        await flow.suspend('approval')
      }).run(),
    ).rejects.toThrow('RecordStore')
  })

    it('throws when resuming a non-existent flow', async () => {
    setupStore()

    await expect(makeFlow('missing', async () => {}).resume('non-existent-flow-id')).rejects.toThrow(
      'No suspended flow found',
    )
  })
})

describe('config store integration', () => {
  it('uses store from config globally', async () => {
    const store = inMemoryRecordStore()
    // Simulate what config does — sets store on runtime
    updateHooks({ records: store })

    const run = await makeFlow('cfg-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: '1' }))
      await flow.suspend('approval')
    }).run()

    expect(run.status).toBe('suspended')
    const snapshot = await store.get(`crux:flow:${run.flowId}`)
    expect(snapshot).toBeTruthy()
    expect(snapshot?.status).toBe('suspended')
  })
})

describe('snapshot contents', () => {
  it('persists completed step outputs in the snapshot', async () => {
    setupStore()

    const run = await makeFlow('snapshot-test', async (flow) => {
      await flow.step('plan', async () => ({
        planId: 'abc',
        title: 'My Plan',
      }))
      await flow.step('research', async () => ({ sources: ['a', 'b'] }))
      await flow.suspend('review')
    }).run()

    expect(run.status).toBe('suspended')
    const snapshot = await store.get(`crux:flow:${run.flowId}`)
    expect(snapshot).toBeTruthy()

    const steps = snapshot?.completedSteps as any
    expect(steps.plan.output).toEqual({ planId: 'abc', title: 'My Plan' })
    expect(steps.research.output).toEqual({ sources: ['a', 'b'] })
  })
})

// ─────────────────────────────────────────────────────────────────
// Phase 2: Cancel, timeout, expiration
// ─────────────────────────────────────────────────────────────────

describe('flow cancel', () => {
  it('cancels a flow from within and returns cancelled status', async () => {
    setupStore()

    const stepsExecuted: string[] = []
    const run = await makeFlow('cancel-test', async (flow) => {
      await flow.step('plan', async () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.cancel('User rejected the plan')

      // Should not execute
      await flow.step('execute', async () => {
        stepsExecuted.push('execute')
      })
    }).run()

    expect(run.status).toBe('cancelled')
    if (run.status === 'cancelled') {
      expect(run.cancelReason).toBe('User rejected the plan')
      expect(run.flowId).toBeTruthy()
    }
    expect(stepsExecuted).toEqual(['plan'])
  })

    it('cancels a suspended flow externally', async () => {
    setupStore()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    // Suspend
    const run = await makeFlow('ext-cancel', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval')
    }).run()
    expect(run.status).toBe('suspended')

    // Cancel externally
    const { cancelFlow } = await import('../../src/flow/scope')
    await cancelFlow(run.flowId, 'Admin cancelled')

    // Verify store was updated
    const snapshot = await store.get(`crux:flow:${run.flowId}`)
    expect(snapshot?.status).toBe('cancelled')
    await observe.flush()
    expect(transport.records.filter((record) => record.type === 'run:end')).toContainEqual(
      expect.objectContaining({ status: 'cancelled' }),
    )
  })
})

describe('flow resume failure recovery', () => {
  it('retries in the same process after a transient resume error', async () => {
    setupStore()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let shouldFail = true
    const retryFlow = makeFlow('retry-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval')
      if (shouldFail) {
        shouldFail = false
        throw new Error('transient failure')
      }
      return flow.step('execute', async () => 'done')
    })

    const suspended = await retryFlow.run()
    expect(suspended.status).toBe('suspended')
    await signalFlow(suspended.flowId, 'approval')
    await expect(retryFlow.resume(suspended.flowId)).rejects.toThrow('transient failure')

    const snapshotAfterError = await store.get(`crux:flow:${suspended.flowId}`)
    expect(snapshotAfterError?.status).toBe('suspended')
    await expect(retryFlow.resume(suspended.flowId)).resolves.toMatchObject({ status: 'completed', output: 'done' })

    await observe.flush()
    expect(transport.records.filter((record) => record.type === 'run:end')).toEqual([
      expect.objectContaining({ status: 'ok' }),
    ])
  })

  it('cancels in the same process after a resume error', async () => {
    setupStore()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const cancelAfterErrorFlow = makeFlow('cancel-after-error', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval')
      throw new Error('boom')
    })

    const suspended = await cancelAfterErrorFlow.run()
    await signalFlow(suspended.flowId, 'approval')
    await expect(cancelAfterErrorFlow.resume(suspended.flowId)).rejects.toThrow('boom')

    const { cancelFlow } = await import('../../src/flow/scope')
    await cancelFlow(suspended.flowId, 'Admin cancelled after error')
    expect((await store.get(`crux:flow:${suspended.flowId}`))?.status).toBe('cancelled')

    await observe.flush()
    expect(transport.records.filter((record) => record.type === 'run:end')).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ])
  })
})

describe('flow timeout/expiration', () => {
  it('returns expired status when resuming after timeout', async () => {
    setupStore()

    const run = await makeFlow('timeout-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', { timeout: '0ms' }) // immediate expiry
    }).run()
    expect(run.status).toBe('suspended')

    // Signal it (but it should be expired)
    await signalFlow(run.flowId, 'approval')

    // Wait a tick to ensure timeout passes
    await new Promise((r) => setTimeout(r, 5))

    // Resume — should be expired
    const resumed = await makeFlow('timeout-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', { timeout: '0ms' })
      await flow.step('execute', async () => 'done')
    }).resume(run.flowId)

    expect(resumed.status).toBe('expired')
    if (resumed.status === 'expired') {
      expect(resumed.flowId).toBe(run.flowId)
    }
  })

    it('calls onExpired callback when flow expires', async () => {
    setupStore()
    let expiredCalled = false
    let expiredFlowId: string | undefined

    const run = await makeFlow('expire-cb', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', {
        timeout: '0ms',
        onExpired: async (state) => {
          expiredCalled = true
          expiredFlowId = state.flowId
        },
      })
    }).run()

    await new Promise((r) => setTimeout(r, 5))

    await makeFlow('expire-cb', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', {
        timeout: '0ms',
        onExpired: async (state) => {
          expiredCalled = true
          expiredFlowId = state.flowId
        },
      })
    }).resume(run.flowId)

    expect(expiredCalled).toBe(true)
    expect(expiredFlowId).toBe(run.flowId)
  })
})

// ─────────────────────────────────────────────────────────────────
// Phase 3: Multi-suspend, waitUntil, flow listing
// ─────────────────────────────────────────────────────────────────

describe('multi-suspend lifecycle', () => {
  it('suspends, resumes, suspends again, resumes again, and completes', async () => {
    setupStore()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const stepsExecuted: string[] = []

    const flowFn = async (flow: { flowId: string; step: any; suspend: any }) => {
      const plan = await flow.step('plan', async () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.suspend('plan-approval')

      const draft = await flow.step('draft', async () => {
        stepsExecuted.push('draft')
        return { draft: 'content', planId: plan.planId }
      })

      await flow.suspend('content-review')

      const result = await flow.step('publish', async () => {
        stepsExecuted.push('publish')
        return { published: true, draft: draft.draft }
      })

      return result
    }

    const multiFlow = makeFlow('multi', flowFn)

    // First run — suspends at plan-approval
    const run1 = await multiFlow.run()
    expect(run1.status).toBe('suspended')
    if (run1.status === 'suspended') expect(run1.suspendedAt).toBe('plan-approval')
    expect(stepsExecuted).toEqual(['plan'])

    // Signal plan-approval and resume — suspends at content-review
    await signalFlow(run1.flowId, 'plan-approval')
    stepsExecuted.length = 0
    const run2 = await multiFlow.resume(run1.flowId)
    expect(run2.status).toBe('suspended')
    if (run2.status === 'suspended') expect(run2.suspendedAt).toBe('content-review')
    expect(stepsExecuted).toEqual(['draft'])

    // Signal content-review and resume — completes
    await signalFlow(run2.flowId, 'content-review')
    stepsExecuted.length = 0
    const run3 = await multiFlow.resume(run2.flowId)
    expect(run3.status).toBe('completed')
    if (run3.status === 'completed') {
      expect(run3.output).toEqual({ published: true, draft: 'content' })
    }
    expect(stepsExecuted).toEqual(['publish'])
    await observe.flush()

    const lifecycle = transport.records.filter(
      (record) => record.type.startsWith('run:') && record.runId === transport.records[0]?.runId,
    )
    expect(lifecycle.map((record) => record.type)).toEqual([
      'run:start',
      'run:suspend',
      'run:resume',
      'run:suspend',
      'run:resume',
      'run:end',
    ])
    expect(new Set(lifecycle.map((record) => record.segmentId))).toHaveLength(3)
    expect(lifecycle.filter((record) => record.type === 'run:end')).toHaveLength(1)
  })

    it('each suspend point has independent signals', async () => {
    setupStore()

    const flowFn = async (flow: { flowId: string; step: any; suspend: any }) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('gate-1')
      await flow.step('execute', async () => 'done')
      await flow.suspend('gate-2')
      return 'final'
    }

    const indFlow = makeFlow('independent', flowFn)

    // Suspend at gate-1
    const run1 = await indFlow.run()
    expect(run1.status).toBe('suspended')

    // Signal gate-2 (wrong gate) — should still be suspended at gate-1
    await signalFlow(run1.flowId, 'gate-2')
    // Resume — gate-1 has no signal, should re-suspend at gate-1
    const run2 = await indFlow.resume(run1.flowId)
    expect(run2.status).toBe('suspended')
    if (run2.status === 'suspended') expect(run2.suspendedAt).toBe('gate-1')
  })

    it('accumulates cached step outputs across suspend cycles', async () => {
    setupStore()

    const flowFn = async (flow: { flowId: string; step: any; suspend: any }) => {
      await flow.step('step-a', async () => ({ a: 1 }))
      await flow.suspend('gate-1')
      await flow.step('step-b', async () => ({ b: 2 }))
      await flow.suspend('gate-2')
      await flow.step('step-c', async () => ({ c: 3 }))
      return 'done'
    }

    const accumFlow = makeFlow('accum', flowFn)

    // Run 1 — cache step-a, suspend
    const run1 = await accumFlow.run()
    let snapshot = await store.get(`crux:flow:${run1.flowId}`)
    expect(Object.keys((snapshot?.completedSteps as any) ?? {})).toEqual(['step-a'])

    // Signal and resume — cache step-b, suspend
    await signalFlow(run1.flowId, 'gate-1')
    await accumFlow.resume(run1.flowId)
    snapshot = await store.get(`crux:flow:${run1.flowId}`)
    expect(Object.keys((snapshot?.completedSteps as any) ?? {})).toContain('step-a')
    expect(Object.keys((snapshot?.completedSteps as any) ?? {})).toContain('step-b')
  })
})

describe('flow.waitUntil', () => {
  it('suspends when condition returns false, continues when true on resume', async () => {
    setupStore()
    let conditionValue = false

    const flowFn = async (flow: { flowId: string; step: any; suspend: any; waitUntil: any }) => {
      await flow.step('prepare', async () => 'prepared')
      await flow.waitUntil('data-ready', () => conditionValue)
      return flow.step('process', async () => 'processed')
    }

    const waitFlow = makeFlow('wait-test', flowFn)

    // First run — condition is false, should suspend
    const run1 = await waitFlow.run()
    expect(run1.status).toBe('suspended')
    if (run1.status === 'suspended') expect(run1.suspendedAt).toBe('data-ready')

    // Set condition to true and resume
    conditionValue = true
    const run2 = await waitFlow.resume(run1.flowId)
    expect(run2.status).toBe('completed')
    if (run2.status === 'completed') expect(run2.output).toBe('processed')
  })

    it('re-suspends when condition is still false on resume', async () => {
    setupStore()
    const conditionValue = false

    const flowFn = async (flow: { flowId: string; step: any; suspend: any; waitUntil: any }) => {
      await flow.step('prepare', async () => 'prepared')
      await flow.waitUntil('data-ready', () => conditionValue)
      return 'done'
    }

    const resuspendFlow = makeFlow('wait-resuspend', flowFn)

    const run1 = await resuspendFlow.run()
    expect(run1.status).toBe('suspended')

    // Resume without changing condition — should re-suspend
    const run2 = await resuspendFlow.resume(run1.flowId)
    expect(run2.status).toBe('suspended')
    if (run2.status === 'suspended') expect(run2.suspendedAt).toBe('data-ready')
  })

    it('supports timeout like suspend', async () => {
    setupStore()

    const flowFn = async (flow: { flowId: string; step: any; suspend: any; waitUntil: any }) => {
      await flow.step('prepare', async () => 'prepared')
      await flow.waitUntil('data-ready', () => false, { timeout: '0ms' })
      return 'done'
    }

    const timeoutFlow = makeFlow('wait-timeout', flowFn)

    const run1 = await timeoutFlow.run()
    expect(run1.status).toBe('suspended')

    await new Promise((r) => setTimeout(r, 5))

    const run2 = await timeoutFlow.resume(run1.flowId)
    expect(run2.status).toBe('expired')
  })
})

describe('listFlows', () => {
  it('lists all flows by status', async () => {
    setupStore()

    // Create a suspended flow
    await makeFlow('flow-a', async (flow) => {
      await flow.step('plan', async () => 'a')
      await flow.suspend('gate')
    }).run()

    // Create another suspended flow
    await makeFlow('flow-b', async (flow) => {
      await flow.step('plan', async () => 'b')
      await flow.suspend('gate')
    }).run()

    const suspended = await listFlows({ status: 'suspended' })
    expect(suspended.length).toBeGreaterThanOrEqual(2)
    expect(suspended.every((f) => f.status === 'suspended')).toBe(true)
    expect(suspended.every((f) => f.flowId && f.name && f.suspendedAt)).toBe(true)
  })

    it('returns empty array when no flows match', async () => {
    setupStore()
    const result = await listFlows({ status: 'expired' })
    expect(result).toEqual([])
  })

    it('includes flow metadata in results', async () => {
    setupStore()

    const run = await makeFlow('metadata-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('review')
    }).run()

    const flows = await listFlows({ status: 'suspended' })
    const found = flows.find((f) => f.flowId === run.flowId)
    expect(found).toBeTruthy()
    expect(found?.name).toBe('metadata-test')
    expect(found?.suspendedAt).toBe('review')
    expect(found?.createdAt).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// Phase 4: Instrumentation hooks for suspend/resume lifecycle
// ─────────────────────────────────────────────────────────────────

describe('suspend/resume instrumentation hooks', () => {
  afterEach(() => {
    resetHooks()
  })

    it('preserves trace context (sessionId, parentFlowId) across resume', async () => {
    setupStore()
    let resumedSessionId: string | undefined
    let resumedParentFlowId: string | undefined

    const { runWithExecutionContext, getExecutionContext } = await import('../../src/runtime/execution-context')

    const flowFn = async (flow: { flowId: string; step: any; suspend: any }) => {
      await flow.step('plan', async () => 'planned')
      const ctx = getExecutionContext()
      resumedSessionId = ctx?.sessionId
      resumedParentFlowId = ctx?.parentFlowId
      await flow.suspend('approval')
      return 'done'
    }

    const ctxFlow = makeFlow('ctx-test', flowFn)

    // Start with a session context
    const run = await runWithExecutionContext({ sessionId: 'sess-abc' }, () => ctxFlow.run())

    await signalFlow(run.flowId, 'approval')

    // Resume — should still have sessionId from snapshot
    const resumed = await ctxFlow.resume(run.flowId)
    expect(resumed.status).toBe('completed')
    // The snapshot should carry sessionId
    const snapshot = await store.get(`crux:flow:${run.flowId}`)
    expect(snapshot?.traceContext).toBeTruthy()
    expect((snapshot?.traceContext as any)?.sessionId).toBe('sess-abc')
  })
})
