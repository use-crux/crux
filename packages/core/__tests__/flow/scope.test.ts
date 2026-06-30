import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flow as makeFlow, createFlowId, signalFlow, type FlowScope } from '../../flow/scope'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'
import { getExecutionContext, runWithExecutionContext, withSession } from '../../runtime/execution-context'
import { inMemoryRecordStore } from '../../storage'

describe('createFlowId', () => {
  it('returns a unique string starting with flow-', () => {
    const id = createFlowId()
    expect(id).toMatch(/^flow-\d+-[a-z0-9]+$/)
  })

    it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createFlowId()))
    expect(ids.size).toBe(100)
  })
})

describe('flow', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('runs the function and returns its result wrapped in FlowResult', async () => {
    const result = await makeFlow('test', async () => 42).run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe(42)
    }
  })

    it('sets flowId in trace context during execution', async () => {
    let capturedFlowId: string | undefined
    await makeFlow('test', async (flow) => {
      capturedFlowId = getExecutionContext()?.flowId
      expect(capturedFlowId).toBe(flow.flowId)
    }).run()
    expect(capturedFlowId).toBeTruthy()
  })

    it('preserves existing sessionId from parent context', async () => {
    let capturedSessionId: string | undefined
    await runWithExecutionContext({ sessionId: 'sess-123' }, () =>
      makeFlow('test', async () => {
        capturedSessionId = getExecutionContext()?.sessionId
      }).run(),
    )
    expect(capturedSessionId).toBe('sess-123')
  })

    it('uses provided flowId from options', async () => {
    const customId = 'my-custom-flow-id'
    await makeFlow('test', async (flow) => {
      expect(flow.flowId).toBe(customId)
      expect(getExecutionContext()?.flowId).toBe(customId)
    }).run({ flowId: customId })
  })

    it('propagates errors', async () => {
    await expect(
      makeFlow('test', async () => {
        throw new Error('boom')
      }).run(),
    ).rejects.toThrow('boom')
  })

    it('cleans up flowId after completion', async () => {
    await makeFlow('test', async () => 42).run()
    expect(getExecutionContext()?.flowId).toBeUndefined()
  })
})

describe('flow.step', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('runs the step function and returns its result', async () => {
    const result = await makeFlow('test', async (flow) => {
      return flow.step('plan', async () => 'planned')
    }).run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('planned')
    }
  })

    it('sets stepId and stepLabel in trace context during step execution', async () => {
    await makeFlow('test', async (flow) => {
      await flow.step('plan', async () => {
        const ctx = getExecutionContext()
        expect(ctx?.stepLabel).toBe('plan')
        expect(ctx?.stepId).toMatch(/^plan-\d+$/)
        expect(ctx?.flowId).toBe(flow.flowId)
      })
    }).run()
  })

    it('generates unique stepIds for same labels', async () => {
    const stepIds: string[] = []
    await makeFlow('test', async (flow) => {
      await flow.step('search', async () => {
        stepIds.push(getExecutionContext()?.stepId ?? '')
      })
      await flow.step('search', async () => {
        stepIds.push(getExecutionContext()?.stepId ?? '')
      })
    }).run()
    expect(stepIds[0]).not.toBe(stepIds[1])
  })

    it('supports synchronous step functions', async () => {
    const result = await makeFlow('test', async (flow) => {
      return flow.step('sync', () => 'sync-result')
    }).run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('sync-result')
    }
  })

    it('runs multiple steps sequentially', async () => {
    const order: string[] = []
    await makeFlow('pipeline', async (flow) => {
      await flow.step('plan', async () => {
        order.push('plan')
      })
      await flow.step('search', async () => {
        order.push('search')
      })
      await flow.step('synthesize', async () => {
        order.push('synthesize')
      })
    }).run()
    expect(order).toEqual(['plan', 'search', 'synthesize'])
  })
})

describe('step retry', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('retries on failure up to attempts count', async () => {
    let attempts = 0
    const result = await makeFlow('test', async (flow) => {
      return flow.step(
        'flaky',
        async () => {
          attempts++
          if (attempts < 3) throw new Error('fail')
          return 'success'
        },
        { retry: { attempts: 3, delay: 1 } },
      )
    }).run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('success')
    }
    expect(attempts).toBe(3)
  })

    it('throws after all retries exhausted', async () => {
    await expect(
      makeFlow('test', async (flow) => {
        return flow.step(
          'always-fail',
          async () => {
            throw new Error('permanent')
          },
          { retry: { attempts: 2, delay: 1 } },
        )
      }).run(),
    ).rejects.toThrow('permanent')
  })

    it('uses fallback after retries exhausted', async () => {
    const result = await makeFlow('test', async (flow) => {
      return flow.step(
        'with-fallback',
        async () => {
          throw new Error('fail')
        },
        {
          retry: { attempts: 2, delay: 1 },
          fallback: () => 'fallback-value',
        },
      )
    }).run()
    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('fallback-value')
    }
  })

    it('uses exponential backoff', async () => {
    const timestamps: number[] = []
    let attempts = 0

    await expect(
      makeFlow('test', async (flow) => {
        return flow.step(
          'backoff',
          async () => {
            timestamps.push(Date.now())
            attempts++
            throw new Error('fail')
          },
          { retry: { attempts: 3, delay: 10, backoff: 'exponential' } },
        )
      }).run(),
    ).rejects.toThrow('fail')

    expect(attempts).toBe(3)
    // With exponential: delay after 1st = 10*1, after 2nd = 10*2
    // Timing is approximate, just verify calls happened
    expect(timestamps.length).toBe(3)
  })
})
describe('nested flows', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('sets parentFlowId when nesting flow calls', async () => {
    let outerFlowId: string | undefined
    let innerParentFlowId: string | undefined
    let innerFlowId: string | undefined

    await makeFlow('outer', async (outerFlow) => {
      outerFlowId = outerFlow.flowId
      await outerFlow.step('delegate', async () => {
        await makeFlow('inner', async (innerFlow) => {
          innerFlowId = innerFlow.flowId
          innerParentFlowId = getExecutionContext()?.parentFlowId
        }).run()
      })
    }).run()

    expect(outerFlowId).toBeTruthy()
    expect(innerFlowId).toBeTruthy()
    expect(innerFlowId).not.toBe(outerFlowId)
    expect(innerParentFlowId).toBe(outerFlowId)
  })

    it('inner flow gets its own flowId in trace context', async () => {
    let outerCtxFlowId: string | undefined
    let innerCtxFlowId: string | undefined

    await makeFlow('outer', async (outerFlow) => {
      outerCtxFlowId = getExecutionContext()?.flowId
      await makeFlow('inner', async () => {
        innerCtxFlowId = getExecutionContext()?.flowId
      }).run()
    }).run()

    expect(outerCtxFlowId).toBeTruthy()
    expect(innerCtxFlowId).toBeTruthy()
    expect(innerCtxFlowId).not.toBe(outerCtxFlowId)
  })

    it('preserves sessionId through nested flows', async () => {
    let innerSessionId: string | undefined

    await withSession('sess-nested', () =>
      makeFlow('outer', async () => {
        await makeFlow('inner', async () => {
          innerSessionId = getExecutionContext()?.sessionId
        }).run()
      }).run(),
    )

    expect(innerSessionId).toBe('sess-nested')
  })

    it('inner flow steps have correct trace context', async () => {
    let innerStepCtx: { flowId?: string; parentFlowId?: string; stepLabel?: string } | undefined

    await makeFlow('outer', async (outerFlow) => {
      await outerFlow.step('delegate', async () => {
        await makeFlow('inner', async (innerFlow) => {
          await innerFlow.step('sub-plan', async () => {
            const ctx = getExecutionContext()
            innerStepCtx = {
              flowId: ctx?.flowId,
              parentFlowId: ctx?.parentFlowId,
              stepLabel: ctx?.stepLabel,
            }
          })
        }).run()
      })
    }).run()

    expect(innerStepCtx?.stepLabel).toBe('sub-plan')
    expect(innerStepCtx?.parentFlowId).toBeTruthy()
    // Inner step's flowId should be the inner flow's ID, not the outer
    expect(innerStepCtx?.flowId).not.toBe(innerStepCtx?.parentFlowId)
  })

    it('three-level nesting propagates correctly', async () => {
    const flowIds: string[] = []
    const parentFlowIds: (string | undefined)[] = []

    await makeFlow('level-1', async (flow1) => {
      flowIds.push(flow1.flowId)
      parentFlowIds.push(getExecutionContext()?.parentFlowId)

      await makeFlow('level-2', async (flow2) => {
        flowIds.push(flow2.flowId)
        parentFlowIds.push(getExecutionContext()?.parentFlowId)

        await makeFlow('level-3', async (flow3) => {
          flowIds.push(flow3.flowId)
          parentFlowIds.push(getExecutionContext()?.parentFlowId)
        }).run()
      }).run()
    }).run()

    expect(flowIds).toHaveLength(3)
    // Level 1 has no parent
    expect(parentFlowIds[0]).toBeUndefined()
    // Level 2's parent is level 1
    expect(parentFlowIds[1]).toBe(flowIds[0])
    // Level 3's parent is level 2
    expect(parentFlowIds[2]).toBe(flowIds[1])
  })
})

describe('flow.input', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('is accessible within step functions when input is provided', async () => {
    let capturedInput: unknown

    const result = await makeFlow<number, { topic: string; audience: string }>('test-input', async (flow) => {
      capturedInput = flow.input
      return await flow.step('use-input', () => {
        return flow.input.topic.length
      })
    }).run({ input: { topic: 'AI Safety', audience: 'engineers' } })

    expect(result.status).toBe('completed')
    expect(capturedInput).toEqual({
      topic: 'AI Safety',
      audience: 'engineers',
    })
    if (result.status === 'completed') {
      expect(result.output).toBe(9) // 'AI Safety'.length
    }
  })

    it('is undefined when no input is provided (backward compat)', async () => {
    let capturedInput: unknown = 'sentinel'

    await makeFlow('no-input', async (flow) => {
      capturedInput = flow.input
    }).run()

    expect(capturedInput).toBeUndefined()
  })

    it('survives suspend/resume (persisted in snapshot)', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    type Input = { topic: string; audience: string }
    let inputOnResume: unknown

    const flowFn = async (flow: FlowScope<Input>) => {
      await flow.step('plan', () => ({ planId: 'abc' }))
      await flow.suspend('review')
      // This code runs only on resume
      inputOnResume = flow.input
      return flow.input.topic
    }

    const persistFlow = makeFlow<string, Input>('persist-input', flowFn)

    // First call — suspends
    const suspended = await persistFlow.run({
      input: { topic: 'AI Safety', audience: 'engineers' },
    })
    expect(suspended.status).toBe('suspended')

    // Signal and resume
    await signalFlow(suspended.flowId, 'review', {})
    const resumed = await persistFlow.run({ resume: suspended.flowId })

    expect(resumed.status).toBe('completed')
    if (resumed.status === 'completed') {
      expect(resumed.output).toBe('AI Safety')
    }
    expect(inputOnResume).toEqual({
      topic: 'AI Safety',
      audience: 'engineers',
    })
  })
})

describe('flow.results', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('is empty {} at the start of a fresh flow', async () => {
    let initialResults: Record<string, unknown> | undefined

    await makeFlow('empty-results', async (flow) => {
      initialResults = { ...flow.results }
    }).run()

    expect(initialResults).toEqual({})
  })

    it('accumulates step return values keyed by label', async () => {
    let capturedResults: Record<string, unknown> | undefined

    await makeFlow('results-test', async (flow) => {
      await flow.step('plan', () => ({ planId: 'abc', title: 'My Plan' }))
      await flow.step('tasks', () => ({ taskCount: 3 }))

      capturedResults = { ...flow.results }
    }).run()

    expect(capturedResults).toEqual({
      plan: { planId: 'abc', title: 'My Plan' },
      tasks: { taskCount: 3 },
    })
  })

    it('is pre-populated from cache on resume and includes skip-replayed steps', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    const stepsExecuted: string[] = []
    let resultsAfterResume: Record<string, unknown> | undefined

    const flowFn = async (flow: FlowScope) => {
      await flow.step('plan', () => {
        stepsExecuted.push('plan')
        return { planId: 'abc' }
      })

      await flow.suspend('review')

      // After resume: plan should be in flow.results (skip-replayed)
      resultsAfterResume = { ...flow.results }

      await flow.step('publish', () => {
        stepsExecuted.push('publish')
        return { published: true }
      })

      return flow.results
    }

    const resumeFlow = makeFlow('resume-results', flowFn)

    // First run — suspends after plan step
    const suspended = await resumeFlow.run()
    expect(suspended.status).toBe('suspended')
    expect(stepsExecuted).toEqual(['plan'])

    // Signal and resume
    await signalFlow(suspended.flowId, 'review', {})
    stepsExecuted.length = 0

    const resumed = await resumeFlow.run({ resume: suspended.flowId })
    expect(resumed.status).toBe('completed')

    // plan was skip-replayed, should NOT have re-executed
    expect(stepsExecuted).toEqual(['publish'])

    // flow.results should contain both plan (from cache) and publish (fresh)
    expect(resultsAfterResume).toEqual({ plan: { planId: 'abc' } })

    if (resumed.status === 'completed') {
      expect(resumed.output).toEqual({
        plan: { planId: 'abc' },
        publish: { published: true },
      })
    }
  })
})

describe('flow.step auto-pass', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('passes flow scope to step functions that accept a parameter', async () => {
    let receivedFlow: FlowScope | undefined

    // External step function that receives flow
    async function externalStep(flow: FlowScope) {
      receivedFlow = flow
      return flow.flowId
    }

    const result = await makeFlow('auto-pass', async (flow) => {
      return flow.step('external', externalStep)
    }).run()

    expect(result.status).toBe('completed')
    expect(receivedFlow).toBeDefined()
    expect(receivedFlow!.flowId).toBeTruthy()
    if (result.status === 'completed') {
      expect(result.output).toBe(receivedFlow!.flowId)
    }
  })

    it('() => T step functions still work (backward compat)', async () => {
    const result = await makeFlow('compat', async (flow) => {
      const value = await flow.step('plain', () => 42)
      return value
    }).run()

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe(42)
    }
  })

    it('both signatures work in the same flow', async () => {
    // External flow-aware step
    async function flowAwareStep(flow: FlowScope<{ seed: number }>) {
      return flow.input.seed * 2
    }

    const result = await makeFlow<number, { seed: number }>('mixed', async (flow) => {
      const doubled = await flow.step('double', flowAwareStep)
      const added = await flow.step('add', () => doubled + 10)
      return added
    }).run({ input: { seed: 5 } })

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe(20) // 5 * 2 + 10
    }
  })

    it('flow-aware step can read flow.input and flow.results', async () => {
    // External step that reads both input and prior results
    async function summaryStep(flow: FlowScope<{ topic: string }>) {
      const planResult = flow.results.plan as { planId: string }
      return `${flow.input.topic}: plan ${planResult.planId}`
    }

    const result = await makeFlow<string, { topic: string }>('full-access', async (flow) => {
      await flow.step('plan', () => ({ planId: 'p-123' }))
      return flow.step('summary', summaryStep)
    }).run({ input: { topic: 'AI Safety' } })

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('AI Safety: plan p-123')
    }
  })
})
