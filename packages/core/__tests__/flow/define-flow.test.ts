import { describe, it, expect, afterEach } from 'vitest'
import { flow as makeFlow, signalFlow, cancelFlow, type FlowHandle, type FlowRunOptions } from '../../flow/scope'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'
import { inMemoryCruxStore } from '../../store/memory'
import type { CruxStore } from '../../store/types'

let store: CruxStore

function setupStore() {
  store = inMemoryCruxStore()
  updateRuntime({ store })
  return store
}

describe('flow', () => {
  afterEach(() => {
    resetRuntime()
  })

  // ─────────────────────────────────────────────────────────────────
  // Handle shape & basic execution
  // ─────────────────────────────────────────────────────────────────

  it('returns a frozen FlowHandle with .name, .run, .signal', () => {
    const handle = makeFlow('my-flow', async () => 42)

    expect(handle.name).toBe('my-flow')
    expect(typeof handle.run).toBe('function')
    expect(typeof handle.signal).toBe('function')
    expect(Object.isFrozen(handle)).toBe(true)
  })

    it('infers handler return type through to FlowResult<T>.output', async () => {
    const handle = makeFlow('typed-flow', async () => ({
      count: 42,
      label: 'test',
    }))
    const result = await handle.run()

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      // Type inference check: output should be { count: number; label: string }
      expect(result.output.count).toBe(42)
      expect(result.output.label).toBe('test')
    }
  })

    it('.run() executes the flow and returns FlowResult with completed status', async () => {
    const handle = makeFlow('basic', async (flow) => {
      return flow.step('compute', () => 'hello')
    })

    const result = await handle.run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('hello')
      expect(result.flowId).toBeTruthy()
    }
  })

    it('.run() passes input to the flow scope', async () => {
    const handle = makeFlow<string, { name: string }>('input-flow', async (flow) => {
      return `Hello, ${flow.input.name}`
    })

    const result = await handle.run({ input: { name: 'World' } })
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('Hello, World')
    }
  })

    it('.run() passes options through to flow internals', async () => {
    const handle = makeFlow('options-flow', async (flow) => {
      return flow.flowId
    })

    const result = await handle.run({ flowId: 'custom-id-123' })
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('custom-id-123')
    }
  })

    it('error in step propagates correctly', async () => {
    const handle = makeFlow('error-flow', async (flow) => {
      return flow.step('fail', () => {
        throw new Error('step failed')
      })
    })

    await expect(handle.run()).rejects.toThrow('step failed')
  })

  // ─────────────────────────────────────────────────────────────────
  // Full suspend → signal → resume → complete lifecycle
  // ─────────────────────────────────────────────────────────────────

  it('define → run → suspend → signal → resume → complete lifecycle', async () => {
    setupStore()
    const stepsExecuted: string[] = []

    const handle = makeFlow('lifecycle', async (flow) => {
      const plan = await flow.step('plan', async () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.suspend('approval')

      const result = await flow.step('execute', async () => {
        stepsExecuted.push('execute')
        return { done: true, planId: plan.planId }
      })

      return result
    })

    // Run — should suspend after 'plan' step
    const suspended = await handle.run()
    expect(suspended.status).toBe('suspended')
    if (suspended.status !== 'suspended') return
    expect(suspended.suspendedAt).toBe('approval')
    expect(stepsExecuted).toEqual(['plan'])

    // Signal through the handle
    await handle.signal(suspended.flowId, 'approval', { approvedBy: 'henri' })

    // Resume — should complete
    stepsExecuted.length = 0
    const completed = await handle.run({ resume: suspended.flowId })
    expect(completed.status).toBe('completed')
    if (completed.status === 'completed') {
      expect(completed.output).toEqual({ done: true, planId: 'abc' })
      expect(completed.flowId).toBe(suspended.flowId)
    }

    // 'execute' ran, 'plan' was NOT re-executed
    expect(stepsExecuted).toEqual(['execute'])
  })

  // ─────────────────────────────────────────────────────────────────
  // Skip-replay: cached outputs returned without re-executing
  // ─────────────────────────────────────────────────────────────────

  it('skip-replay returns cached outputs without re-executing step functions', async () => {
    setupStore()
    let planCallCount = 0
    let researchCallCount = 0

    const handle = makeFlow('skip-replay', async (flow) => {
      const plan = await flow.step('plan', async () => {
        planCallCount++
        return { planId: 'plan-1', title: 'Research Plan' }
      })

      const research = await flow.step('research', async () => {
        researchCallCount++
        return { sources: ['a', 'b'], planId: plan.planId }
      })

      await flow.suspend('review')

      return flow.step('publish', async () => {
        return { published: true, sources: research.sources }
      })
    })

    // First run — executes plan + research, suspends at review
    const suspended = await handle.run()
    expect(suspended.status).toBe('suspended')
    expect(planCallCount).toBe(1)
    expect(researchCallCount).toBe(1)

    // Signal and resume — plan and research should be skip-replayed (cached)
    await handle.signal(suspended.flowId, 'review')
    planCallCount = 0
    researchCallCount = 0

    const completed = await handle.run({ resume: suspended.flowId })
    expect(completed.status).toBe('completed')

    // Neither plan nor research were re-executed
    expect(planCallCount).toBe(0)
    expect(researchCallCount).toBe(0)

    // But their outputs were still available via skip-replay
    if (completed.status === 'completed') {
      expect(completed.output).toEqual({
        published: true,
        sources: ['a', 'b'],
      })
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // Multiple suspend points in a single flow
  // ─────────────────────────────────────────────────────────────────

  it('handles multiple suspend points in a single flow', async () => {
    setupStore()
    const stepsExecuted: string[] = []

    const handle = makeFlow('multi-suspend', async (flow) => {
      const plan = await flow.step('plan', async () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.suspend('plan-approval')

      const draft = await flow.step('draft', async () => {
        stepsExecuted.push('draft')
        return { content: 'article text', planId: plan.planId }
      })

      await flow.suspend('content-review')

      const result = await flow.step('publish', async () => {
        stepsExecuted.push('publish')
        return { published: true, content: draft.content }
      })

      return result
    })

    // Suspend 1: plan-approval
    const run1 = await handle.run()
    expect(run1.status).toBe('suspended')
    if (run1.status === 'suspended') expect(run1.suspendedAt).toBe('plan-approval')
    expect(stepsExecuted).toEqual(['plan'])

    // Signal plan-approval and resume → suspends at content-review
    await handle.signal(run1.flowId, 'plan-approval')
    stepsExecuted.length = 0
    const run2 = await handle.run({ resume: run1.flowId })
    expect(run2.status).toBe('suspended')
    if (run2.status === 'suspended') expect(run2.suspendedAt).toBe('content-review')
    expect(stepsExecuted).toEqual(['draft']) // plan was skip-replayed

    // Signal content-review and resume → completes
    await handle.signal(run2.flowId, 'content-review')
    stepsExecuted.length = 0
    const run3 = await handle.run({ resume: run2.flowId })
    expect(run3.status).toBe('completed')
    if (run3.status === 'completed') {
      expect(run3.output).toEqual({ published: true, content: 'article text' })
    }
    expect(stepsExecuted).toEqual(['publish']) // plan + draft skip-replayed
  })

  // ─────────────────────────────────────────────────────────────────
  // .signal() on non-existent flowId
  // ─────────────────────────────────────────────────────────────────

  it('.signal() on non-existent flowId throws descriptive error when resumed', async () => {
    setupStore()

    const handle = makeFlow('signal-miss', async (flow) => {
      await flow.suspend('gate')
      return 'done'
    })

    // Signaling a non-existent flowId writes to store (no error at signal time)
    // But resuming a non-existent flow should throw
    await expect(handle.run({ resume: 'non-existent-flow-id' })).rejects.toThrow('No suspended flow found')
  })

  // ─────────────────────────────────────────────────────────────────
  // Cancellation through cancelFlow on a flow instance
  // ─────────────────────────────────────────────────────────────────

  it('cancellation works on flow instances via cancelFlow', async () => {
    setupStore()

    const handle = makeFlow('cancel-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval')
      return 'should not reach'
    })

    // Suspend the flow
    const suspended = await handle.run()
    expect(suspended.status).toBe('suspended')

    // Cancel externally via cancelFlow
    await cancelFlow(suspended.flowId, 'User rejected')

    // Verify store was updated
    const snapshot = await store.get(`crux:flow:${suspended.flowId}`)
    expect(snapshot?.status).toBe('cancelled')
    expect(snapshot?.cancelReason).toBe('User rejected')
  })

    it('cancellation from within a flow handler returns cancelled status', async () => {
    setupStore()
    const stepsExecuted: string[] = []

    const handle = makeFlow('internal-cancel', async (flow) => {
      await flow.step('plan', async () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.cancel('Plan was invalid')

      // Should not execute
      await flow.step('execute', async () => {
        stepsExecuted.push('execute')
      })
    })

    const result = await handle.run()
    expect(result.status).toBe('cancelled')
    if (result.status === 'cancelled') {
      expect(result.cancelReason).toBe('Plan was invalid')
    }
    expect(stepsExecuted).toEqual(['plan'])
  })

  // ─────────────────────────────────────────────────────────────────
  // Expiry through timeout on a flow instance
  // ─────────────────────────────────────────────────────────────────

  it('expiry works on flow instances when timeout elapses', async () => {
    setupStore()

    const handle = makeFlow('expire-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', { timeout: '0ms' }) // immediate expiry
      return 'should not reach'
    })

    // Suspend with immediate timeout
    const suspended = await handle.run()
    expect(suspended.status).toBe('suspended')

    // Signal it (but it should be expired by now)
    await handle.signal(suspended.flowId, 'approval')
    await new Promise((r) => setTimeout(r, 5))

    // Resume — should be expired
    const expired = await handle.run({ resume: suspended.flowId })
    expect(expired.status).toBe('expired')
    if (expired.status === 'expired') {
      expect(expired.flowId).toBe(suspended.flowId)
    }
  })

    it('expiry fires onExpired callback through flow', async () => {
    setupStore()
    let expiredCalled = false
    let expiredFlowId: string | undefined

    const handle = makeFlow('expire-cb-test', async (flow) => {
      await flow.step('plan', async () => ({ planId: 'abc' }))
      await flow.suspend('approval', {
        timeout: '0ms',
        onExpired: async (state) => {
          expiredCalled = true
          expiredFlowId = state.flowId
        },
      })
    })

    const suspended = await handle.run()
    await new Promise((r) => setTimeout(r, 5))

    const expired = await handle.run({ resume: suspended.flowId })
    expect(expired.status).toBe('expired')
    expect(expiredCalled).toBe(true)
    expect(expiredFlowId).toBe(suspended.flowId)
  })
})
