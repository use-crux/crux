import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  defineSetupContributor,
  type SetupAction,
  type SetupContext,
  type SetupFinding,
} from '@use-crux/core/setup'
import type {
  RuntimeEngineDefinition,
  RuntimeSetupPort,
} from '@use-crux/core/runtime'
import { staticDefinitionFiles } from '../files'
import { inspectDeferSources } from './defer-source-evidence'

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

interface DeferSetupOptions {
  readonly runtime: RuntimeEngineDefinition | undefined
}

interface DeferEvidence {
  readonly active: boolean
  readonly named: boolean
  readonly inlineHostCapabilityMissing: boolean
  readonly namedDurabilityMissing: readonly string[]
  readonly packages: Readonly<Record<string, string>>
}

const DOCS_URL = 'https://cruxjs.dev/docs/guides/background-work/troubleshooting'

/** Create setup diagnostics for active request-scoped defer usage. */
export function createDeferSetupContributor(options: DeferSetupOptions) {
  async function findings(
    project: SetupContext,
  ): Promise<readonly SetupFinding[]> {
    const evidence = await inspectEvidence(project.root)
    if (!evidence.active) return []
    return inspectActiveDefer(evidence, options.runtime)
  }

  return defineSetupContributor({
    id: 'defer',
    inspect: findings,
    async plan(project): Promise<readonly SetupAction[]> {
      return (await findings(project))
        .filter(({ severity }) => severity !== 'info')
        .map(actionForFinding)
    },
  })
}

async function inspectEvidence(root: string): Promise<DeferEvidence> {
  const installed = await packages(root)
  const sourceEvidence = await inspectDeferSources(staticDefinitionFiles(root))
  return {
    ...sourceEvidence,
    packages: installed,
  }
}

async function packages(
  root: string,
): Promise<Readonly<Record<string, string>>> {
  try {
    const source = await readFile(join(root, 'package.json'), 'utf8')
    const manifest = JSON.parse(source) as PackageManifest
    return { ...manifest.dependencies, ...manifest.devDependencies }
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  }
}

async function inspectActiveDefer(
  evidence: DeferEvidence,
  runtime: RuntimeEngineDefinition | undefined,
): Promise<readonly SetupFinding[]> {
  const findings: SetupFinding[] = []
  if ('next' in evidence.packages && !('@use-crux/next' in evidence.packages)) {
    findings.push(nextIntegrationFinding())
  }
  if (evidence.inlineHostCapabilityMissing)
    findings.push(hostCapabilityFinding())
  findings.push(
    ...evidence.namedDurabilityMissing.map(durableFinalizationFinding),
  )
  if (!evidence.named) return findings
  if (!runtime) {
    findings.push(runtimeMissingFinding(), maintenanceFinding())
    return findings
  }
  const setup =
    runtime.kind === 'in-process'
      ? (runtime.store as { readonly setup?: RuntimeSetupPort }).setup
      : undefined
  if (setup && !(await setup.check()).ok)
    findings.push(schemaFinding(runtime.id))
  if (
    runtime.kind === 'host-bound' ||
    runtime.maintenance?.autoStart === false
  ) {
    findings.push(
      maintenanceFinding(
        runtime.kind === 'host-bound' ? runtime.host : runtime.id,
      ),
    )
  }
  return findings
}

function nextIntegrationFinding(): SetupFinding {
  return finding({
    code: 'DEFER_NEXT_INTEGRATION_MISSING',
    resource: '@use-crux/next',
    severity: 'error',
    message:
      'Active defer() usage in a Next.js project requires the Crux response-finished host integration.',
    remediation: 'pnpm add @use-crux/next',
    agentPrompt:
      'Install @use-crux/next and wrap each Next handler that calls defer() with withNextDefer().',
  })
}

function runtimeMissingFinding(): SetupFinding {
  return finding({
    code: 'DEFER_RUNTIME_NOT_CONFIGURED',
    resource: 'runtime',
    severity: 'error',
    message:
      'Named defer(target, input) usage requires a configured Runtime Engine.',
    remediation:
      'Configure `runtime` in crux.config.ts before using named defer targets.',
    agentPrompt:
      'Configure a Crux Runtime Engine in crux.config.ts for the detected named defer(target, input) calls.',
  })
}

function hostCapabilityFinding(): SetupFinding {
  return finding({
    code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
    resource: 'host-lifetime',
    severity: 'warning',
    message:
      'Active inline defer() usage has no statically detected host lifetime wrapper.',
    remediation:
      'Wrap the request handler with the Crux integration for its host.',
    agentPrompt:
      'Detect the request host and wrap each handler that calls inline defer() with the matching Crux host lifetime integration.',
  })
}

function durableFinalizationFinding(wrapper: string): SetupFinding {
  if (wrapper === 'withNodeDefer') {
    return finding({
      code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
      resource: wrapper,
      severity: 'error',
      message:
        'withNodeDefer cannot finalize named deferred work before response commitment.',
      remediation:
        'Move named defer(target, input) to a host integration that supports durable finalization; keep withNodeDefer for inline callbacks only.',
      agentPrompt:
        'Move the detected named defer(target, input) call out of withNodeDefer and into a host boundary that can durably finalize Runtime work before committing its response.',
    })
  }
  if (wrapper === 'host-lifetime') {
    return finding({
      code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
      resource: wrapper,
      severity: 'error',
      message:
        'Named defer(target, input) usage has no statically detected durable host boundary.',
      remediation:
        'Wrap the handler with withNextDefer, withAfterDefer, or withWaitUntilDefer and set `durableFinalization: true` after configuring Runtime durability.',
      agentPrompt:
        'Wrap the detected named defer(target, input) call in the matching host integration with literal `durableFinalization: true`, then verify Runtime setup.',
    })
  }
  return finding({
    code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
    resource: wrapper,
    severity: 'error',
    message: `${wrapper} does not statically prove durable finalization for named deferred work.`,
    remediation: `Set \`durableFinalization: true\` in the ${wrapper} options after configuring Runtime durability.`,
    agentPrompt: `Set literal \`durableFinalization: true\` in the ${wrapper} options for the handler containing named defer(target, input), then verify Runtime setup.`,
  })
}

function schemaFinding(runtimeId: string): SetupFinding {
  return finding({
    code: 'DEFER_ADAPTER_SCHEMA_NOT_READY',
    resource: runtimeId,
    severity: 'error',
    message:
      'The configured Runtime adapter schema is not ready for durable deferred intents.',
    remediation: 'Run `crux setup --apply`, then rerun `crux setup --check`.',
    agentPrompt: `Apply the safe additive setup for Runtime adapter ${runtimeId}, then verify its deferred-intent schema.`,
  })
}

function maintenanceFinding(host = 'runtime'): SetupFinding {
  return finding({
    code: 'DEFER_MAINTENANCE_NOT_PROVEN',
    resource: host,
    severity: 'warning',
    message:
      'Named deferred work requires a deployed worker and recurring Runtime maintenance.',
    remediation:
      'Deploy the Runtime wake handler and schedule its maintenance entry point for this host.',
    agentPrompt: `Verify the ${host} Runtime wake worker is deployed and its maintenance entry point runs on a recurring schedule.`,
  })
}

function finding(
  value: Omit<SetupFinding, 'contributorId' | 'docsUrl'>,
): SetupFinding {
  return { contributorId: 'defer', docsUrl: DOCS_URL, ...value }
}

function actionForFinding(value: SetupFinding): SetupAction {
  const resource = value.resource
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return {
    id: `defer.resolve-${value.code.toLowerCase().replaceAll('_', '-')}-${resource}`,
    contributorId: 'defer',
    classification: 'requires-approval',
    title: `Resolve ${value.code}`,
    description: value.message,
    ...(value.remediation === undefined
      ? {}
      : { remediation: value.remediation }),
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
