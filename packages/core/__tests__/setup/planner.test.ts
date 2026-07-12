import { describe, expect, it, vi } from 'vitest'

import {
  createSetupPlanner,
  defineSetupContributor,
  type SetupContext,
} from '../../src/setup/index.js'

const project: SetupContext = { root: '/project', mode: 'check' }

describe('createSetupPlanner', () => {
  it('preserves contributor and finding order during check', async () => {
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'first',
        inspect: async () => [
          {
            contributorId: 'first',
            code: 'FIRST_A',
            resource: 'a',
            severity: 'warning',
            message: 'first a',
          },
          {
            contributorId: 'first',
            code: 'FIRST_B',
            resource: 'b',
            severity: 'info',
            message: 'first b',
          },
        ],
        plan: async () => [],
      }),
      defineSetupContributor({
        id: 'second',
        inspect: async () => [
          {
            contributorId: 'second',
            code: 'SECOND',
            resource: 'c',
            severity: 'info',
            message: 'second',
          },
        ],
        plan: async () => [],
      }),
    ])

    const report = await planner.check(project)

    expect(report.findings.map((finding) => finding.code)).toEqual([
      'FIRST_A',
      'FIRST_B',
      'SECOND',
    ])
  })

  it('checks without invoking plan or apply', async () => {
    const plan = vi.fn(async () => [])
    const apply = vi.fn(async () => ({ ok: true, actionId: 'unused', findings: [] }))
    const planner = createSetupPlanner([
      defineSetupContributor({ id: 'only', inspect: async () => [], plan, apply }),
    ])
    await planner.check(project)
    expect(plan).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('contains contributor failures and continues with siblings', async () => {
    const planner = createSetupPlanner([
      defineSetupContributor({ id: 'broken', inspect: async () => { throw new Error('boom') }, plan: async () => [] }),
      defineSetupContributor({ id: 'healthy', inspect: async () => [{ contributorId: 'healthy', code: 'OK', resource: 'runtime', severity: 'info', message: 'ok' }], plan: async () => [] }),
    ])
    const report = await planner.check(project)
    expect(report.ok).toBe(false)
    expect(report.findings.map(({ code }) => code)).toEqual(['SETUP_CONTRIBUTOR_FAILED', 'OK'])
  })

  it('plans in contributor order', async () => {
    const action = (id: string, contributorId: string) => ({ id, contributorId, classification: 'safe-additive' as const, title: id, description: id })
    const planner = createSetupPlanner([
      defineSetupContributor({ id: 'a', inspect: async () => [], plan: async () => [action('a.1', 'a')] }),
      defineSetupContributor({ id: 'b', inspect: async () => [], plan: async () => [action('b.1', 'b')] }),
    ])
    expect((await planner.plan({ ...project, mode: 'plan' })).actions.map(({ id }) => id)).toEqual(['a.1', 'b.1'])
  })

  it('applies only safe additive actions and re-inspects', async () => {
    let healthy = false
    const apply = vi.fn(async (action) => { healthy = true; return { ok: true, actionId: action.id, findings: [] } })
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'runtime',
        inspect: async () => healthy ? [] : [{ contributorId: 'runtime', code: 'MISSING', resource: 'table', severity: 'error', message: 'missing' }],
        plan: async () => [
          { id: 'runtime.apply', contributorId: 'runtime', classification: 'safe-additive', title: 'Apply', description: 'Apply' },
          { id: 'runtime.manual', contributorId: 'runtime', classification: 'requires-approval', title: 'Manual', description: 'Manual' },
        ],
        apply,
      }),
    ])
    const report = await planner.apply({ ...project, mode: 'apply' })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(report.ok).toBe(true)
    expect(report.applied).toHaveLength(1)
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'SETUP_ACTION_REQUIRES_APPROVAL' }))
  })
})
