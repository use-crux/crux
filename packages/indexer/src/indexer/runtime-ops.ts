import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  createRuntime,
  createRuntimeError,
  runtimeHostOnlyError,
  runtimeRequiredError,
  runtimeTargetMap,
  transportBindingHealth,
  type ResolvedRuntimeEngine,
  type RuntimeEngineDefinition,
  type RuntimeProgram,
  type RuntimeSetupResult,
  type RuntimeSetupPort,
  type RuntimeTargetRuntimeRef,
  type WorkId,
  type RuntimeWorkState,
} from '@use-crux/core/runtime'
import { loadProjectConfig } from './config'
import { importUserModule } from './imports'
import { namespaceFallbackFinding } from './setup/namespace-finding'
import {
  decodeRuntimeArtifactManifest,
  RuntimeArtifactManifestDecodeError,
} from './runtime-artifacts/manifest-codec'
import type {
  RuntimeInspectOperationResult,
  RuntimeOperationOptions,
  RuntimeOperationResult,
  RuntimePreflightMissingTarget,
  RuntimeStatusCount,
} from './runtime-ops-types'
import { inspectApplicationWork } from './runtime-ops-application-work'

export type {
  RuntimeCancelOperationResult,
  RuntimeInspectOperationResult,
  RuntimeOperationKind,
  RuntimeOperationOptions,
  RuntimeOperationResult,
  RuntimeRetryOperationResult,
  RuntimeStatusCount,
  RuntimeStatusOperationResult,
} from './runtime-ops-types'

const WORK_STATUSES = [
  'pending',
  'leased',
  'suspended',
  'completed',
  'cancelled',
  'blocked',
  'dead-letter',
] as const satisfies readonly RuntimeWorkState[]

/** Execute one runtime operation against the configured Runtime Engine. */
export async function runRuntimeOperation(
  options: RuntimeOperationOptions,
): Promise<RuntimeOperationResult> {
  const runtimeDefinition = await loadRuntimeDefinition(options.root)
  switch (options.operation) {
    case 'preflight':
      return await preflightRuntime(options.root, runtimeDefinition)
    case 'status':
      return await withRuntime(
        options.root,
        runtimeDefinition,
        false,
        async (runtime) => {
          const base = {
            operation: 'status' as const,
            ok: true as const,
            namespace: runtime.namespace,
            counts: await statusCounts(runtime),
          }
          if (!options.includeDetails) return base
          return {
            ...base,
            ...(await statusDetails(runtime, options.root)),
          }
        },
      )
    case 'inspect':
      return await withRuntime(
        options.root,
        runtimeDefinition,
        false,
        async (runtime) => inspectWork(runtime, requiredWorkId(options)),
      )
    case 'retry':
      return await withRuntime(
        options.root,
        runtimeDefinition,
        true,
        async (runtime) => {
          const retry = await runtime.kernel.retryWork({
            namespace: runtime.namespace,
            workId: requiredWorkId(options),
          })
          const dispatch = retry.retried
            ? await runtime.dispatcher.nudge()
            : undefined
          return {
            operation: 'retry',
            ok: retry.retried,
            namespace: runtime.namespace,
            retried: retry.retried,
            ...(retry.retried ? { work: retry.work, dispatch } : {}),
          }
        },
      )
    case 'cancel':
      return await withRuntime(
        options.root,
        runtimeDefinition,
        false,
        async (runtime) => {
          const cancel = await runtime.kernel.cancelWork({
            namespace: runtime.namespace,
            workId: requiredWorkId(options),
          })
          return {
            operation: 'cancel',
            ok: cancel.cancelled,
            namespace: runtime.namespace,
            cancelled: cancel.cancelled,
          }
        },
      )
  }
}

async function loadRuntimeDefinition(
  root: string,
): Promise<RuntimeEngineDefinition> {
  const { loaded } = await loadProjectConfig(root, undefined, 'runtime-rich')
  const runtime = loaded.crux?.config.runtime
  if (!runtime) throw runtimeRequiredError({ api: 'crux runtime' })
  return runtime
}

function setupPort(runtime: RuntimeEngineDefinition): RuntimeSetupPort {
  if (runtime.kind === 'host-bound') {
    throw runtimeHostOnlyError({
      api: 'crux setup',
      host: runtime.host,
      entry: runtime.entry,
    })
  }
  const setup = (runtime.store as { readonly setup?: RuntimeSetupPort }).setup
  if (!setup) {
    throw createRuntimeError({
      code: 'CAPABILITY_MISSING',
      whatFailed: `Runtime adapter \`${runtime.id}\` does not expose setup checks.`,
      why: 'This runtime stack has no adapter-owned resources for the setup command to verify.',
      whatStillWorks:
        'Runtime work can still run when the configured store and wake adapters are usable.',
      nextStep:
        'Use `crux runtime status` to inspect durable work, or choose an adapter with setup support.',
    })
  }
  return setup
}

async function withRuntime<T>(
  root: string,
  runtimeDefinition: RuntimeEngineDefinition,
  loadTargets: boolean,
  fn: (runtime: ResolvedRuntimeEngine) => Promise<T>,
): Promise<T> {
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  if (loadTargets) await importGeneratedTargetModules(root)
  const runtime = createRuntime({
    runtime: runtimeDefinition,
    targets: loadTargets ? runtimeTargetMap(runtimeRef) : {},
    startMaintenance: false,
  })
  runtimeRef.current = runtime
  try {
    return await fn(runtime)
  } finally {
    runtime.dispose()
  }
}

async function importGeneratedTargetModules(root: string): Promise<void> {
  let manifest: { readonly targets?: readonly { readonly module?: string }[] }
  try {
    manifest = JSON.parse(
      await readFile(
        join(root, '.crux/generated/runtime/manifest.json'),
        'utf8',
      ),
    ) as typeof manifest
  } catch {
    return
  }
  const modules = new Set(
    (manifest.targets ?? [])
      .map((target) => target.module)
      .filter((module): module is string => typeof module === 'string'),
  )
  for (const module of modules) {
    await importUserModule(resolve(root, module), 8_000)
  }
}

async function statusCounts(
  runtime: ResolvedRuntimeEngine,
): Promise<readonly RuntimeStatusCount[]> {
  return [
    ...(await runtime.store.state.countWork({ namespace: runtime.namespace })),
  ].sort(
    (a, b) =>
      codepointCompare(a.namespace, b.namespace) ||
      codepointCompare(a.status, b.status) ||
      codepointCompare(a.targetId, b.targetId),
  )
}

export async function preflightRuntime(
  root: string,
  runtimeDefinition: RuntimeEngineDefinition,
): Promise<RuntimeOperationResult> {
  if (runtimeDefinition.kind === 'host-bound') {
    return {
      operation: 'preflight',
      ok: true,
      setup: { ok: true, findings: [] },
      missingTargets: [],
    }
  }
  const setup = appendNamespaceFallbackFinding(
    await setupPort(runtimeDefinition).check(),
    runtimeDefinition,
  )
  if (!setup.ok) {
    return {
      operation: 'preflight',
      ok: false,
      setup,
      missingTargets: [],
    }
  }
  return await withRuntime(root, runtimeDefinition, false, async (runtime) => {
    const manifest = await readRuntimeArtifactManifest(root)
    const counts = await statusCounts(runtime)
    const missingTargets = missingRuntimeTargets(manifest, counts)
    return {
      operation: 'preflight',
      ok: missingTargets.length === 0,
      namespace: runtime.namespace,
      setup,
      missingTargets,
    }
  })
}

function appendNamespaceFallbackFinding(
  setup: RuntimeSetupResult,
  runtime: RuntimeEngineDefinition,
): RuntimeSetupResult {
  const finding = namespaceFallbackFinding(runtime)
  if (finding === undefined) return setup
  return {
    ...setup,
    findings: [...setup.findings, finding],
  }
}

async function readRuntimeArtifactManifest(
  root: string,
): Promise<{ readonly targets: readonly { readonly name: string }[] }> {
  const parsed: unknown = JSON.parse(
    await readFile(join(root, '.crux/generated/runtime/manifest.json'), 'utf8'),
  )
  try {
    return decodeRuntimeArtifactManifest(parsed)
  } catch (error) {
    if (!(error instanceof RuntimeArtifactManifestDecodeError)) throw error
    const incompatible = error.code === 'version_incompatible'
    throw createRuntimeError({
      code: incompatible
        ? 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE'
        : 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
      whatFailed: incompatible
        ? `Runtime artifact manifest schema version ${String(error.version ?? 'unknown')} is not supported.`
        : 'The generated Runtime artifact manifest is incomplete or malformed.',
      why: incompatible
        ? 'This Crux version requires the current generated Runtime file format.'
        : 'Its fields do not match the Runtime artifact manifest v3 contract.',
      whatStillWorks:
        'Authored Runtime targets and Eval definitions are unchanged.',
      nextStep:
        'Run `crux runtime generate` to recreate the generated Runtime files.',
    })
  }
}

function missingRuntimeTargets(
  manifest: { readonly targets: readonly { readonly name: string }[] },
  counts: readonly RuntimeStatusCount[],
): readonly RuntimePreflightMissingTarget[] {
  const known = new Set(manifest.targets.map((target) => target.name))
  const missing = new Map<string, number>()
  for (const count of counts) {
    if (isTerminalRuntimeStatus(count.status) || known.has(count.targetId)) {
      continue
    }
    missing.set(
      count.targetId,
      (missing.get(count.targetId) ?? 0) + count.count,
    )
  }
  return [...missing]
    .map(([targetId, count]) => ({ targetId, count }))
    .sort((a, b) => codepointCompare(a.targetId, b.targetId))
}

function isTerminalRuntimeStatus(
  status: RuntimeStatusCount['status'],
): boolean {
  return (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'blocked' ||
    status === 'dead-letter'
  )
}

async function statusDetails(
  runtime: ResolvedRuntimeEngine,
  root: string,
) {
  const work = (
    await Promise.all(
      WORK_STATUSES.map((status) =>
        runtime.store.state.listWork({
          namespace: runtime.namespace,
          status,
          limit: 200,
        }),
      ),
    )
  ).flat()
  const transports = await loadTransportBindingHealth(root, runtime)
  return {
    work: work.sort(
      (a, b) =>
        codepointCompare(a.status, b.status) ||
        codepointCompare(a.targetId, b.targetId) ||
        codepointCompare(a.workId, b.workId),
    ),
    timers: await runtime.store.timers.list({
      namespace: runtime.namespace,
      limit: 200,
    }),
    outbox: await runtime.store.outbox.list({
      namespace: runtime.namespace,
      limit: 200,
    }),
    ...(transports ? { transports } : {}),
  }
}

/**
 * Load bounded transport binding health from the generated Runtime program.
 *
 * @remarks Missing program modules, missing transport ports, and empty binding
 * lists return `undefined` rather than fabricated health rows.
 */
async function loadTransportBindingHealth(
  root: string,
  runtime: ResolvedRuntimeEngine,
) {
  if (!runtime.store.transports) {
    return undefined
  }

  try {
    const modulePath = join(root, '.crux/generated/runtime/program.ts')
    const loaded = (await importUserModule(modulePath)) as {
      readonly runtimeProgram?: RuntimeProgram
      readonly default?: RuntimeProgram
    }
    const program = loaded.runtimeProgram ?? loaded.default
    if (!program?.transports || program.transports.length === 0) {
      return undefined
    }

    return await transportBindingHealth({
      store: runtime.store,
      namespace: runtime.namespace,
      program,
    })
  } catch {
    return undefined
  }
}

function codepointCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

async function inspectWork(
  runtime: ResolvedRuntimeEngine,
  workId: WorkId,
): Promise<RuntimeInspectOperationResult> {
  const work = await runtime.store.state.getWork(workId, {
    namespace: runtime.namespace,
  })
  if (!work) {
    return {
      operation: 'inspect',
      ok: false,
      namespace: runtime.namespace,
    }
  }
  const flowId =
    work.work.kind === 'flow.resume' || work.work.kind === 'flow.timeout'
      ? work.work.flowId
      : undefined
  const snapshot = flowId
    ? await runtime.store.state.getSnapshot(flowId, {
        namespace: runtime.namespace,
      })
    : undefined
  const application =
    work.application && snapshot
      ? await inspectApplicationWork(runtime, work, snapshot)
      : undefined
  return {
    operation: 'inspect',
    ok: true,
    namespace: runtime.namespace,
    work,
    ...(snapshot
      ? {
          flow: {
            flowId: snapshot.flowId,
            status: snapshot.status,
            fingerprint: snapshot.fingerprint,
            pendingSuspends: snapshot.pendingSuspends,
          },
        }
      : {}),
    ...(application ? { application } : {}),
  }
}

function requiredWorkId(options: RuntimeOperationOptions): WorkId {
  if (options.workId) return options.workId as WorkId
  throw createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `crux runtime ${options.operation} requires a work id.`,
    why: 'The operation needs one durable work item to inspect or mutate.',
    whatStillWorks:
      '`crux runtime status` can still list work without a work id.',
    nextStep: `Run \`crux runtime ${options.operation} <workId>\`.`,
  })
}
