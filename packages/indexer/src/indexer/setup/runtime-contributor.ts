import {
  defineSetupContributor,
  type SetupAction,
  type SetupContext,
  type SetupFinding,
} from '@use-crux/core/setup'
import {
  runtimeHostOnlyError,
  type RuntimeEngineDefinition,
  type RuntimeSetupFinding,
  type RuntimeSetupPort,
} from '@use-crux/core/runtime'
import { redactSetupText } from './redact'
import { namespaceFallbackFinding } from './namespace-finding'

const DOCS_URL = 'https://cruxjs.dev/docs/guides/setup#apply-safe-changes'

type RuntimeSetupResolution =
  | { readonly kind: 'port'; readonly port: RuntimeSetupPort }
  | { readonly kind: 'finding'; readonly finding: SetupFinding }

function mapFinding(finding: RuntimeSetupFinding): SetupFinding {
  const resource = redactSetupText(finding.resource)
  const message = redactSetupText(finding.message)
  const remediation =
    finding.remediation === undefined
      ? undefined
      : redactSetupText(finding.remediation)
  return {
    contributorId: 'runtime',
    code: finding.code,
    resource,
    severity: 'error',
    message,
    docsUrl: DOCS_URL,
    ...(remediation === undefined ? {} : { remediation }),
    agentPrompt: [
      'Configure Crux Runtime setup.',
      `Finding: ${finding.code} on ${resource}.`,
      message,
      ...(remediation === undefined
        ? []
        : [`Apply this remediation: ${remediation}`]),
    ].join('\n'),
  }
}

function resolveSetup(
  runtime: RuntimeEngineDefinition,
): RuntimeSetupResolution {
  if (runtime.kind === 'host-bound') {
    const error = runtimeHostOnlyError({
      api: 'crux setup',
      host: runtime.host,
      entry: runtime.entry,
    })
    return {
      kind: 'finding',
      finding: {
        contributorId: 'runtime',
        code: error.code,
        resource: runtime.host,
        severity: 'error',
        message: redactSetupText(error.message),
        docsUrl: DOCS_URL,
        ...(runtime.entry === undefined
          ? {}
          : { remediation: redactSetupText(runtime.entry) }),
        agentPrompt: `Configure the host-bound Crux Runtime for ${runtime.host} using the generated host entry.`,
      },
    }
  }

  const port = (runtime.store as { readonly setup?: RuntimeSetupPort }).setup
  if (port) return { kind: 'port', port }
  return {
    kind: 'finding',
    finding: {
      contributorId: 'runtime',
      code: 'CAPABILITY_MISSING',
      resource: runtime.id,
      severity: 'info',
      message: `Runtime adapter "${runtime.id}" has no adapter-owned setup resources to verify.`,
      docsUrl: DOCS_URL,
    },
  }
}

/**
 * Create the Runtime setup contributor for one loaded project definition.
 *
 * Adapter resource checks remain behind {@link RuntimeSetupPort}; this adapter
 * maps them into the project-wide setup contract without exposing credentials.
 */
export function createRuntimeSetupContributor(
  runtime: RuntimeEngineDefinition,
) {
  const resolution = resolveSetup(runtime)
  const namespaceFinding = namespaceFallbackFinding(runtime)
  return defineSetupContributor({
    id: 'runtime',
    inspect: async (_project: SetupContext) => [
      ...(resolution.kind === 'port'
        ? (await resolution.port.check()).findings.map(mapFinding)
        : [resolution.finding]),
      ...(namespaceFinding === undefined ? [] : [namespaceFinding]),
    ],
    plan: async (_project: SetupContext) => {
      if (resolution.kind !== 'port') return []
      const result = await resolution.port.check()
      return result.ok ? [] : [runtimeSetupAction()]
    },
    ...(resolution.kind === 'port'
      ? {
          apply: async (_action: SetupAction, _project: SetupContext) => {
            const result = await resolution.port.apply()
            return {
              ok: result.ok,
              actionId: 'runtime.apply-setup',
              findings: result.findings.map(mapFinding),
            }
          },
        }
      : {}),
  })
}

function runtimeSetupAction(): SetupAction {
  return {
    id: 'runtime.apply-setup',
    contributorId: 'runtime',
    classification: 'safe-additive',
    title: 'Create Runtime resources',
    description: 'Apply the Runtime adapter safe additive setup.',
  }
}
