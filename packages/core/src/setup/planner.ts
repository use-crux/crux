import type { SetupAction, SetupContext, SetupContributor, SetupFinding, SetupMode, SetupPlanner, SetupReport, SetupResult } from './types.js'

const failure = (id: string, error: unknown): SetupFinding => ({
  contributorId: id,
  code: 'SETUP_CONTRIBUTOR_FAILED',
  resource: id,
  severity: 'error',
  message: error instanceof Error ? error.message : String(error),
})

const makeReport = (mode: SetupMode, findings: readonly SetupFinding[], actions: readonly SetupAction[] = [], applied: readonly SetupResult[] = []): SetupReport => Object.freeze({
  ok: findings.every(({ severity }) => severity !== 'error'),
  mode,
  findings: Object.freeze([...findings]),
  actions: Object.freeze([...actions]),
  applied: Object.freeze([...applied]),
})

/** Create a pure setup planner over an explicit, ordered contributor list. */
export function createSetupPlanner(contributors: readonly SetupContributor[]): SetupPlanner {
  const registered = Object.freeze([...contributors])

  const inspect = async (project: SetupContext): Promise<SetupFinding[]> => {
    const findings: SetupFinding[] = []
    for (const contributor of registered) {
      try { findings.push(...await contributor.inspect(project)) }
      catch (error) { findings.push(failure(contributor.id, error)) }
    }
    return findings
  }

  const collectActions = async (project: SetupContext): Promise<{ actions: SetupAction[]; findings: SetupFinding[] }> => {
    const actions: SetupAction[] = []
    const findings = await inspect(project)
    for (const contributor of registered) {
      try { actions.push(...await contributor.plan(project)) }
      catch (error) { findings.push(failure(contributor.id, error)) }
    }
    return { actions, findings }
  }

  return Object.freeze({
    async check(project: SetupContext) { return makeReport('check', await inspect({ ...project, mode: 'check' })) },
    async plan(project: SetupContext) {
      const { actions, findings } = await collectActions({ ...project, mode: 'plan' })
      return makeReport('plan', findings, actions)
    },
    async apply(project: SetupContext) {
      const context = { ...project, mode: 'apply' as const }
      const { actions } = await collectActions(context)
      const applied: SetupResult[] = []
      const notices: SetupFinding[] = []
      for (const action of actions) {
        const contributor = registered.find(({ id }) => id === action.contributorId)
        if (action.classification === 'requires-approval') {
          notices.push({ contributorId: action.contributorId, code: 'SETUP_ACTION_REQUIRES_APPROVAL', resource: action.id, severity: 'warning', message: `Action "${action.title}" requires approval.`, ...(action.remediation === undefined ? {} : { remediation: action.remediation }) })
        } else if (contributor?.apply) {
          try { applied.push(await contributor.apply(action, context)) }
          catch (error) { notices.push(failure(contributor.id, error)) }
        }
      }
      return makeReport('apply', [...await inspect(context), ...notices], actions, applied)
    },
  })
}
