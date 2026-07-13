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

  it('keeps plan and apply findings grouped by contributor', async () => {
    const action = (id: string, contributorId: string) => ({
      id,
      contributorId,
      classification: 'safe-additive' as const,
      title: id,
      description: id,
    })
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'first',
        inspect: async () => [
          {
            contributorId: 'first',
            code: 'FIRST_INSPECT',
            resource: 'first',
            severity: 'warning',
            message: 'first',
          },
        ],
        plan: async () => {
          throw new Error('first plan failure')
        },
      }),
      defineSetupContributor({
        id: 'second',
        inspect: async () => [
          {
            contributorId: 'second',
            code: 'SECOND_INSPECT',
            resource: 'second',
            severity: 'warning',
            message: 'second',
          },
        ],
        plan: async () => [action('second.apply', 'second')],
        apply: async () => ({
          ok: false,
          actionId: 'second.apply',
          findings: [
            {
              contributorId: 'second',
              code: 'SECOND_APPLY',
              resource: 'second',
              severity: 'error',
              message: 'second apply',
            },
          ],
        }),
      }),
    ])

    await expect(planner.plan(project)).resolves.toMatchObject({
      findings: [
        expect.objectContaining({ code: 'FIRST_INSPECT' }),
        expect.objectContaining({
          contributorId: 'first',
          code: 'SETUP_CONTRIBUTOR_FAILED',
        }),
        expect.objectContaining({ code: 'SECOND_INSPECT' }),
      ],
    })
    await expect(
      planner.apply({ ...project, mode: 'apply' }),
    ).resolves.toMatchObject({
      findings: [
        expect.objectContaining({ contributorId: 'first' }),
        expect.objectContaining({ contributorId: 'first' }),
        expect.objectContaining({ contributorId: 'second' }),
        expect.objectContaining({ contributorId: 'second' }),
      ],
    })
  })

  it('checks without invoking plan or apply', async () => {
    const plan = vi.fn(async () => [])
    const apply = vi.fn(async () => ({
      ok: true,
      actionId: 'unused',
      findings: [],
    }))
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'only',
        inspect: async () => [],
        plan,
        apply,
      }),
    ])
    await planner.check(project)
    expect(plan).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('contains contributor failures and continues with siblings', async () => {
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'broken',
        inspect: async () => {
          throw new Error('boom')
        },
        plan: async () => [],
      }),
      defineSetupContributor({
        id: 'healthy',
        inspect: async () => [
          {
            contributorId: 'healthy',
            code: 'OK',
            resource: 'runtime',
            severity: 'info',
            message: 'ok',
          },
        ],
        plan: async () => [],
      }),
    ])
    const report = await planner.check(project)
    expect(report.ok).toBe(false)
    expect(report.findings.map(({ code }) => code)).toEqual([
      'SETUP_CONTRIBUTOR_FAILED',
      'OK',
    ])
    expect(JSON.stringify(report)).not.toContain('boom')
  })

  it('contains apply failures and continues with later actions', async () => {
    const applied: string[] = []
    const action = (id: string, contributorId: string) => ({
      id,
      contributorId,
      classification: 'safe-additive' as const,
      title: id,
      description: id,
    })
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'broken',
        inspect: async () => [],
        plan: async () => [action('broken.apply', 'broken')],
        apply: async () => {
          throw new Error('postgres://admin:secret@db')
        },
      }),
      defineSetupContributor({
        id: 'healthy',
        inspect: async () => [],
        plan: async () => [action('healthy.apply', 'healthy')],
        apply: async (current) => {
          applied.push(current.id)
          return { ok: true, actionId: current.id, findings: [] }
        },
      }),
    ])

    const report = await planner.apply({ ...project, mode: 'apply' })

    expect(applied).toEqual(['healthy.apply'])
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        contributorId: 'broken',
        code: 'SETUP_CONTRIBUTOR_FAILED',
      }),
    )
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('keeps plan failures and unsuccessful apply findings in the apply report', async () => {
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'broken-plan',
        inspect: async () => [],
        plan: async () => {
          throw new Error('TOKEN=do-not-report')
        },
      }),
      defineSetupContributor({
        id: 'unsuccessful-apply',
        inspect: async () => [],
        plan: async () => [
          {
            id: 'unsuccessful-apply.run',
            contributorId: 'unsuccessful-apply',
            classification: 'safe-additive',
            title: 'Apply',
            description: 'Apply',
          },
        ],
        apply: async (action) => ({
          ok: false,
          actionId: action.id,
          findings: [
            {
              contributorId: 'unsuccessful-apply',
              code: 'APPLY_REJECTED',
              resource: 'schema',
              severity: 'error',
              message: 'The adapter rejected setup.',
            },
          ],
        }),
      }),
      defineSetupContributor({
        id: 'silent-failure',
        inspect: async () => [],
        plan: async () => [
          {
            id: 'silent-failure.run',
            contributorId: 'silent-failure',
            classification: 'safe-additive',
            title: 'Apply',
            description: 'Apply',
          },
        ],
        apply: async (action) => ({
          ok: false,
          actionId: action.id,
          findings: [],
        }),
      }),
    ])

    const report = await planner.apply({ ...project, mode: 'apply' })

    expect(report.ok).toBe(false)
    expect(report.findings.map(({ code }) => code)).toEqual([
      'SETUP_CONTRIBUTOR_FAILED',
      'APPLY_REJECTED',
      'SETUP_ACTION_FAILED',
    ])
    expect(JSON.stringify(report)).not.toContain('do-not-report')
  })

  it('plans in contributor order', async () => {
    const action = (id: string, contributorId: string) => ({
      id,
      contributorId,
      classification: 'safe-additive' as const,
      title: id,
      description: id,
    })
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'a',
        inspect: async () => [],
        plan: async () => [action('a.1', 'a')],
      }),
      defineSetupContributor({
        id: 'b',
        inspect: async () => [],
        plan: async () => [action('b.1', 'b')],
      }),
    ])
    expect(
      (await planner.plan({ ...project, mode: 'plan' })).actions.map(
        ({ id }) => id,
      ),
    ).toEqual(['a.1', 'b.1'])
  })

  it('applies only safe additive actions and re-inspects', async () => {
    let healthy = false
    const apply = vi.fn(async (action) => {
      healthy = true
      return { ok: true, actionId: action.id, findings: [] }
    })
    const planner = createSetupPlanner([
      defineSetupContributor({
        id: 'runtime',
        inspect: async () =>
          healthy
            ? []
            : [
                {
                  contributorId: 'runtime',
                  code: 'MISSING',
                  resource: 'table',
                  severity: 'error',
                  message: 'missing',
                },
              ],
        plan: async () => [
          {
            id: 'runtime.apply',
            contributorId: 'runtime',
            classification: 'safe-additive',
            title: 'Apply',
            description: 'Apply',
          },
          {
            id: 'runtime.manual',
            contributorId: 'runtime',
            classification: 'requires-approval',
            title: 'Manual',
            description: 'Manual',
          },
        ],
        apply,
      }),
    ])
    const report = await planner.apply({ ...project, mode: 'apply' })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(report.ok).toBe(true)
    expect(report.applied).toHaveLength(1)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'SETUP_ACTION_REQUIRES_APPROVAL' }),
    )
  })
})
