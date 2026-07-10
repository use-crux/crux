/**
 * Integration tests for flow step composition.
 *
 * Verifies the complete distributed step authoring pattern:
 * external step functions using flow.input, flow.results,
 * and auto-pass across suspend/resume cycles.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { flow as makeFlow, signalFlow, type FlowScope } from '../../src/flow/scope'
import { updateHooks, resetHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'

// ── External step functions (simulating separate files) ────────

type ContentInput = { topic: string; audience: string }

/** Flow-aware step: reads flow.input */
async function planStep(flow: FlowScope<ContentInput>) {
  return {
    planId: `plan-${flow.input.topic.toLowerCase().replace(/\s+/g, '-')}`,
    title: `Guide: ${flow.input.topic}`,
    sections: ['intro', 'body', 'conclusion'],
  }
}

/** Plain function: takes explicit args (used via closure wrapper) */
async function taskStep(planId: string, sections: string[]) {
  return {
    taskListId: `tasks-${planId}`,
    taskCount: sections.length,
  }
}

/** Flow-aware step: reads flow.results from previous steps */
async function writeStep(flow: FlowScope<ContentInput>) {
  const plan = flow.results.plan as {
    planId: string
    title: string
    sections: string[]
  }
  const tasks = flow.results.tasks as { taskListId: string; taskCount: number }
  return {
    draft: `${plan.title} (${tasks.taskCount} sections)`,
    wordCount: 1500,
  }
}

/** Flow-aware step: reads flow.results and signal payload */
async function publishStep(flow: FlowScope<ContentInput>) {
  const write = flow.results.write as { draft: string; wordCount: number }
  return {
    published: true,
    title: write.draft,
    audience: flow.input.audience,
  }
}

// ── Tests ──────────────────────────────────────────────────────

afterEach(() => resetHooks())

describe('step composition: end-to-end', () => {
  it('external steps use flow.input and flow.results across a full flow', async () => {
    const result = await makeFlow(
      'content-pipeline',
      async (flow, _input: ContentInput) => {
        // Flow-aware step: auto-pass
        await flow.step('plan', planStep)

        // Plain function: closure wrapper passes explicit args
        const plan = flow.results.plan as { planId: string; sections: string[] }
        await flow.step('tasks', () => taskStep(plan.planId, plan.sections))

        // Flow-aware step: reads flow.results.plan and flow.results.tasks
        await flow.step('write', writeStep)

        // Flow-aware step: reads flow.results.write
        return flow.step('publish', publishStep)
      },
    ).run({ topic: 'AI Safety', audience: 'engineers' })

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toEqual({
        published: true,
        title: 'Guide: AI Safety (3 sections)',
        audience: 'engineers',
      })
    }
  })

    it('flow.input and flow.results survive suspend/resume with external steps', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const stepsExecuted: string[] = []

    const flowFn = async (flow: FlowScope<ContentInput>, _input: ContentInput) => {
      stepsExecuted.push('start')

      await flow.step('plan', planStep)

      const plan = flow.results.plan as { planId: string; sections: string[] }
      await flow.step('tasks', () => taskStep(plan.planId, plan.sections))

      // Suspend for review
      const review = await flow.suspend<{ approved: boolean }>('review')

      stepsExecuted.push('post-resume')

      // After resume: flow.results should have plan + tasks from cache
      expect(flow.results.plan).toBeDefined()
      expect(flow.results.tasks).toBeDefined()

      // flow.input should be restored from snapshot
      expect(flow.input.topic).toBe('AI Safety')

      await flow.step('write', writeStep)
      return flow.step('publish', publishStep)
    }

    const contentFlow = makeFlow('resume-composition', flowFn)

    // First run — suspends
    const suspended = await contentFlow.run({ topic: 'AI Safety', audience: 'engineers' })
    expect(suspended.status).toBe('suspended')
    expect(stepsExecuted).toEqual(['start'])

    // Signal and resume
    await signalFlow(suspended.flowId, 'review', { approved: true })
    stepsExecuted.length = 0

    const resumed = await contentFlow.resume(suspended.flowId)

    expect(resumed.status).toBe('completed')
    expect(stepsExecuted).toEqual(['start', 'post-resume'])

    if (resumed.status === 'completed') {
      expect(resumed.output).toEqual({
        published: true,
        title: 'Guide: AI Safety (3 sections)',
        audience: 'engineers',
      })
    }
  })

    it('mixed pattern: return values and flow.results in same flow', async () => {
    const result = await makeFlow('mixed-pattern', async (flow, _input: { seed: number }) => {
      // Return-value pattern (typed)
      const doubled = await flow.step('double', () => flow.input.seed * 2)

      // Flow.results pattern (untyped escape hatch)
      await flow.step('square', () => doubled * doubled)
      const squared = flow.results.square as number

      // Both accessible
      return `${doubled} squared is ${squared}`
    }).run({ seed: 3 })

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.output).toBe('6 squared is 36')
    }
  })
})
