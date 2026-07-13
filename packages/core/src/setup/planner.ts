import type {
  SetupAction,
  SetupContext,
  SetupContributor,
  SetupFinding,
  SetupMode,
  SetupPlanner,
  SetupReport,
  SetupResult,
} from './types.js'

function contributorFailure(contributorId: string): SetupFinding {
  return {
    contributorId,
    code: 'SETUP_CONTRIBUTOR_FAILED',
    resource: contributorId,
    severity: 'error',
    message: `Setup contributor "${contributorId}" failed.`,
  }
}

function createReport(
  mode: SetupMode,
  findings: readonly SetupFinding[],
  actions: readonly SetupAction[] = [],
  applied: readonly SetupResult[] = [],
): SetupReport {
  return Object.freeze({
    ok: findings.every(({ severity }) => severity !== 'error'),
    mode,
    findings: Object.freeze([...findings]),
    actions: Object.freeze([...actions]),
    applied: Object.freeze([...applied]),
  })
}

/**
 * Create a project setup planner over an explicit contributor list.
 *
 * Contributors run in registration order. Failures are contained as findings
 * so one subsystem cannot prevent the others from inspecting the project.
 * Applying actions is sequential and never rolls back an earlier successful
 * safe-additive action.
 */
export function createSetupPlanner(
  contributors: readonly SetupContributor[],
): SetupPlanner {
  const registered = Object.freeze([...contributors])

  async function collect(project: SetupContext, includePlan: boolean) {
    const buckets = registered.map((contributor) => ({
      contributor,
      actions: [] as SetupAction[],
      inspectFindings: [] as SetupFinding[],
      planFindings: [] as SetupFinding[],
    }))
    for (const bucket of buckets) {
      try {
        bucket.inspectFindings.push(
          ...(await bucket.contributor.inspect(project)),
        )
      } catch {
        bucket.inspectFindings.push(contributorFailure(bucket.contributor.id))
      }
      if (!includePlan) continue
      try {
        bucket.actions.push(...(await bucket.contributor.plan(project)))
      } catch {
        bucket.planFindings.push(contributorFailure(bucket.contributor.id))
      }
    }
    return buckets
  }

  function flattenFindings<
    T extends { readonly findings: readonly SetupFinding[] },
  >(buckets: readonly T[]): SetupFinding[] {
    return buckets.flatMap(({ findings }) => findings)
  }

  return Object.freeze({
    async check(project: SetupContext) {
      const context = { ...project, mode: 'check' as const }
      return createReport(
        'check',
        flattenFindings(
          (await collect(context, false)).map(({ inspectFindings }) => ({
            findings: inspectFindings,
          })),
        ),
      )
    },

    async plan(project: SetupContext) {
      const context = { ...project, mode: 'plan' as const }
      const buckets = await collect(context, true)
      return createReport(
        'plan',
        flattenFindings(
          buckets.map(({ inspectFindings, planFindings }) => ({
            findings: [...inspectFindings, ...planFindings],
          })),
        ),
        buckets.flatMap(({ actions }) => actions),
      )
    },

    async apply(project: SetupContext) {
      const context = { ...project, mode: 'apply' as const }
      const buckets = await collect(context, true)
      const actions = buckets.flatMap(({ actions }) => actions)
      const applied: SetupResult[] = []
      const resultBuckets = buckets.map((bucket) => ({
        ...bucket,
        findings: [...bucket.planFindings],
      }))
      const bucketsByContributor = new Map(
        resultBuckets.map((bucket) => [bucket.contributor.id, bucket]),
      )

      for (const action of actions) {
        const bucket = bucketsByContributor.get(action.contributorId)
        if (action.classification === 'requires-approval') {
          bucket?.findings.push(requiresApprovalFinding(action))
          continue
        }
        const apply = bucket?.contributor.apply
        if (!bucket || !apply) continue
        const { contributor } = bucket

        try {
          const result = await apply(action, context)
          applied.push(result)
          bucket.findings.push(...result.findings)
          if (
            !result.ok &&
            result.findings.every(({ severity }) => severity !== 'error')
          ) {
            bucket.findings.push(actionFailureFinding(action))
          }
        } catch {
          bucket.findings.push(contributorFailure(contributor.id))
        }
      }

      const postApply = await collect(context, false)
      for (const [index, bucket] of resultBuckets.entries()) {
        bucket.findings.push(...postApply[index].inspectFindings)
      }
      return createReport(
        'apply',
        flattenFindings(resultBuckets),
        actions,
        applied,
      )
    },
  })
}

function requiresApprovalFinding(action: SetupAction): SetupFinding {
  return {
    contributorId: action.contributorId,
    code: 'SETUP_ACTION_REQUIRES_APPROVAL',
    resource: action.id,
    severity: 'warning',
    message: `Action "${action.title}" requires approval.`,
    ...(action.remediation === undefined
      ? {}
      : { remediation: action.remediation }),
  }
}

function actionFailureFinding(action: SetupAction): SetupFinding {
  return {
    contributorId: action.contributorId,
    code: 'SETUP_ACTION_FAILED',
    resource: action.id,
    severity: 'error',
    message: `Action "${action.title}" did not complete successfully.`,
    ...(action.remediation === undefined
      ? {}
      : { remediation: action.remediation }),
  }
}
