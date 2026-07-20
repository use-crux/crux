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
import type { CruxHostBinding } from '@use-crux/core'
import { staticDefinitionFiles } from '../files'
import { configuredHostRetainsPlatform } from './defer-host-capability'
import { inspectDeferSources } from './defer-source-evidence'

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

interface DeferSetupOptions {
  readonly runtime: RuntimeEngineDefinition | undefined
  /** Effective host loaded from the selected project config. */
  readonly host?: CruxHostBinding
}

interface DeferEvidence {
  readonly active: boolean
  readonly named: boolean
  readonly hostCapabilityMissing: boolean
  readonly namedDurabilityMissing: readonly string[]
  readonly packages: Readonly<Record<string, string>>
}

const DOCS_URL =
  'https://cruxjs.dev/docs/guides/background-work/troubleshooting'

/** Create setup diagnostics for active request-scoped defer usage. */
export function createDeferSetupContributor(options: DeferSetupOptions) {
  async function findings(
    project: SetupContext,
  ): Promise<readonly SetupFinding[]> {
    const evidence = await inspectEvidence(project.root, options.host)
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

async function inspectEvidence(
  root: string,
  host: CruxHostBinding | undefined,
): Promise<DeferEvidence> {
  const [installed, sourceEvidence] = await Promise.all([
    packages(root),
    inspectDeferSources(staticDefinitionFiles(root)),
  ])
  return {
    ...sourceEvidence,
    hostCapabilityMissing:
      sourceEvidence.hostCapabilityMissing &&
      !configuredHostRetainsPlatform(installed, host),
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
  const missingHost = evidence.hostCapabilityMissing
    ? hostCapabilityFinding(evidence.packages)
    : undefined
  if (missingHost) findings.push(missingHost)
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
      'Install @use-crux/next, import next(), and add `host: next()` to the project config.',
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

function hostCapabilityFinding(
  installed: Readonly<Record<string, string>>,
): SetupFinding | undefined {
  if ('next' in installed) {
    return finding({
      code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
      resource: 'next',
      severity: 'warning',
      message:
        'Active defer() usage on Next.js has no statically detected host binding or strict boundary.',
      remediation: 'Add `host: next()` to config() in crux.config.ts.',
      agentPrompt:
        'Import next() from @use-crux/next and add config({ host: next() }) in crux.config.ts.',
    })
  }
  if ('@use-crux/vercel' in installed || '@vercel/functions' in installed) {
    return finding({
      code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
      resource: 'vercel',
      severity: 'warning',
      message:
        'Active defer() usage on Vercel has no statically detected host binding or strict boundary.',
      remediation: 'Add `host: vercel()` to config() in crux.config.ts.',
      agentPrompt:
        'Import vercel() from @use-crux/vercel and add config({ host: vercel() }) in crux.config.ts.',
    })
  }
  if ('@use-crux/cloudflare' in installed || 'wrangler' in installed) {
    return finding({
      code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
      resource: 'workers',
      severity: 'warning',
      message:
        'Active defer() usage on Cloudflare Workers has no statically detected request-scoped host boundary.',
      remediation:
        'Use @use-crux/cloudflare withCrux, or pass workers({ ctx }) to a per-request boundary.',
      agentPrompt:
        'Wrap the Worker handler with @use-crux/cloudflare withCrux and resolve the current request ExecutionContext through its context option.',
    })
  }
  return undefined
}

function durableFinalizationFinding(wrapper: string): SetupFinding {
  if (wrapper === 'withServerlessDefer') {
    return finding({
      code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
      resource: wrapper,
      severity: 'error',
      message:
        'The withServerlessDefer binding does not statically prove durable finalization for named work.',
      remediation:
        'Use a binding with `durableFinalization: true` after configuring Runtime durability.',
      agentPrompt:
        'Verify the binding passed to withServerlessDefer advertises durableFinalization: true and that Runtime acceptance is configured.',
    })
  }
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
