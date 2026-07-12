import { createSetupPlanner, defineSetupContributor, type SetupAction, type SetupContext, type SetupFinding } from '@use-crux/core/setup'
import { runtimeHostOnlyError, type RuntimeEngineDefinition, type RuntimeSetupFinding, type RuntimeSetupPort } from '@use-crux/core/runtime'

const DOCS_URL = 'https://cruxjs.dev/docs/guides/runtime/setup'

function mapFinding(finding: RuntimeSetupFinding): SetupFinding {
  const remediation = finding.remediation
  return {
    contributorId: 'runtime', code: finding.code, resource: finding.resource,
    severity: 'error', message: finding.message, docsUrl: DOCS_URL,
    ...(remediation === undefined ? {} : { remediation }),
    agentPrompt: ['Configure Crux Runtime setup.', `Finding: ${finding.code} on ${finding.resource}.`, finding.message, ...(remediation === undefined ? [] : [`Apply this remediation: ${remediation}`])].join('\n'),
  }
}

function resolvePort(runtime: RuntimeEngineDefinition): RuntimeSetupPort | SetupFinding {
  if (runtime.kind === 'host-bound') {
    const error = runtimeHostOnlyError({ api: 'crux setup', host: runtime.host, entry: runtime.entry })
    return { contributorId: 'runtime', code: error.code, resource: runtime.host, severity: 'error', message: error.message, docsUrl: DOCS_URL, remediation: runtime.entry, agentPrompt: `Configure the host-bound Crux Runtime for ${runtime.host} using: ${runtime.entry}` }
  }
  const port = (runtime.store as { readonly setup?: RuntimeSetupPort }).setup
  return port ?? { contributorId: 'runtime', code: 'CAPABILITY_MISSING', resource: runtime.id, severity: 'info', message: `Runtime adapter "${runtime.id}" has no adapter-owned setup resources to verify.`, docsUrl: DOCS_URL }
}

/** Create the Runtime setup contributor for one loaded project definition. */
export function createRuntimeSetupContributor(runtime: RuntimeEngineDefinition) {
  const resolved = resolvePort(runtime)
  const port = 'check' in resolved ? resolved : undefined
  return defineSetupContributor({
    id: 'runtime',
    inspect: async (_project: SetupContext) => port ? (await port.check()).findings.map(mapFinding) : [resolved as SetupFinding],
    plan: async (_project: SetupContext) => port && !(await port.check()).ok ? [{ id: 'runtime.apply-setup', contributorId: 'runtime', classification: 'safe-additive' as const, title: 'Create Runtime resources', description: 'Apply the Runtime adapter safe additive setup.' }] : [],
    ...(port ? { apply: async (_action: SetupAction, _project: SetupContext) => { const result = await port.apply(); return { ok: result.ok, actionId: 'runtime.apply-setup', findings: result.findings.map(mapFinding) } } } : {}),
  })
}

export const createRuntimeSetupPlanner = (runtime: RuntimeEngineDefinition) => createSetupPlanner([createRuntimeSetupContributor(runtime)])
