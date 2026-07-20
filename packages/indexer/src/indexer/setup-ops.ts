import { relative } from 'node:path'
import {
  createSetupPlanner,
  defineSetupContributor,
  type SetupFinding,
  type SetupMode,
  type SetupReport,
} from '@use-crux/core/setup'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import type { RuntimeEngineDefinition } from '@use-crux/core/runtime'
import {
  prepareRuntimeArtifacts,
  type PreparedRuntimeArtifacts,
} from './runtime-artifacts'
import {
  changedRuntimeArtifactDestinations,
  commitRuntimeArtifactPlan,
} from './runtime-artifacts/generated-files'
import {
  RuntimeArtifactGenerationError,
  runtimeArtifactGenerationError,
} from './runtime-artifacts/findings'
import type { RuntimeArtifactFinding } from './runtime-artifacts/types'
import { loadProjectConfig } from './config'
import { createRuntimeSetupContributor } from './setup/runtime-contributor'
import { createDeferSetupContributor } from './setup/defer-contributor'

export type SetupGenerationStatus =
  | 'current'
  | 'would-generate'
  | 'generated'
  | 'blocked'
  | 'failed'

export interface SetupCommandResult {
  readonly ok: boolean
  readonly setup: SetupReport
  readonly generation: {
    readonly status: SetupGenerationStatus
    readonly contentHash?: string
    readonly pendingFiles: readonly string[]
    readonly changedFiles: readonly string[]
    readonly findings: readonly RuntimeArtifactFinding[]
  }
}

export interface SetupOperationOptions {
  readonly root: string
  readonly mode: Extract<SetupMode, 'check' | 'apply'>
  /** Final post-apply report supplied by Crux Local's two-stage setup gate. */
  readonly setup?: SetupReport
  /** Fresh runtime-rich Project Index definitions acquired after setup. */
  readonly definitions?: readonly ProjectDefinition[]
  /** Typed failure from acquiring the fresh Project Index snapshot. */
  readonly generationFindings?: readonly RuntimeArtifactFinding[]
}

/** Run setup and the canonical Runtime artifact dry-run/apply gate. */
export async function runSetupOperation(
  options: SetupOperationOptions,
): Promise<SetupCommandResult> {
  const setup = options.setup ?? (await runSetupPlanningOperation(options))
  if (setup.mode !== options.mode) {
    throw new TypeError(
      `Setup report mode '${setup.mode}' does not match requested mode '${options.mode}'.`,
    )
  }
  if (hasSetupErrors(setup)) {
    return setupResult(false, setup, { status: 'blocked' })
  }
  if (options.generationFindings && options.generationFindings.length > 0) {
    return failedGenerationResult(
      setup,
      new RuntimeArtifactGenerationError(options.generationFindings),
    )
  }

  let prepared: PreparedRuntimeArtifacts
  try {
    prepared = await prepareRuntimeArtifacts({
      root: options.root,
      definitions: options.definitions ?? [],
    })
  } catch (error) {
    return failedGenerationResult(setup, runtimeArtifactGenerationError(error))
  }

  const pendingFiles = changedRuntimeArtifactDestinations(prepared.plan)
  if (options.mode === 'check') {
    if (pendingFiles.length === 0) {
      return setupResult(true, setup, {
        status: 'current',
        contentHash: prepared.contentHash,
      })
    }
    return setupResult(
      false,
      appendSetupFinding(setup, staleArtifactsFinding()),
      {
        status: 'would-generate',
        contentHash: prepared.contentHash,
        pendingFiles,
      },
    )
  }

  try {
    const written = await commitRuntimeArtifactPlan(prepared.plan)
    const changedFiles = written.map((file) => projectPath(options.root, file))
    return setupResult(true, setup, {
      status: changedFiles.length === 0 ? 'current' : 'generated',
      contentHash: prepared.contentHash,
      changedFiles,
    })
  } catch (error) {
    return failedGenerationResult(
      setup,
      runtimeArtifactGenerationError(error),
      prepared,
      pendingFiles,
    )
  }
}

/** Run contributors only; Crux Local uses this before acquiring a fresh Index. */
export async function runSetupPlanningOperation(
  options: Pick<SetupOperationOptions, 'root' | 'mode'>,
): Promise<SetupReport> {
  const { loaded } = await loadProjectConfig(
    options.root,
    undefined,
    'runtime-rich',
  )
  const runtime = loaded.crux?.config.runtime as
    | RuntimeEngineDefinition
    | undefined
  const planner = createSetupPlanner([
    ...(loaded.importFailed ? [configFailureContributor()] : []),
    ...(runtime ? [createRuntimeSetupContributor(runtime)] : []),
    createDeferSetupContributor({
      runtime,
      host: loaded.crux?.config.host,
    }),
  ])
  const context = { root: options.root, mode: options.mode }
  return options.mode === 'apply'
    ? planner.apply(context)
    : planner.check(context)
}

function setupResult(
  ok: boolean,
  setup: SetupReport,
  generation: {
    readonly status: SetupGenerationStatus
    readonly contentHash?: string
    readonly pendingFiles?: readonly string[]
    readonly changedFiles?: readonly string[]
    readonly findings?: readonly RuntimeArtifactFinding[]
  },
): SetupCommandResult {
  return Object.freeze({
    ok,
    setup,
    generation: Object.freeze({
      status: generation.status,
      ...(generation.contentHash
        ? { contentHash: generation.contentHash }
        : {}),
      pendingFiles: Object.freeze([...(generation.pendingFiles ?? [])]),
      changedFiles: Object.freeze([...(generation.changedFiles ?? [])]),
      findings: Object.freeze([...(generation.findings ?? [])]),
    }),
  })
}

function failedGenerationResult(
  setup: SetupReport,
  error: RuntimeArtifactGenerationError,
  prepared?: PreparedRuntimeArtifacts,
  pendingFiles: readonly string[] = [],
): SetupCommandResult {
  return setupResult(
    false,
    appendSetupFinding(setup, aggregateGenerationFinding(error)),
    {
      status: 'failed',
      ...(prepared ? { contentHash: prepared.contentHash } : {}),
      ...(prepared ? { pendingFiles } : {}),
      findings: error.findings,
    },
  )
}

function hasSetupErrors(setup: SetupReport): boolean {
  return setup.findings.some((finding) => finding.severity === 'error')
}

function appendSetupFinding(
  setup: SetupReport,
  finding: SetupFinding,
): SetupReport {
  const findings = Object.freeze([...setup.findings, Object.freeze(finding)])
  return Object.freeze({
    ...setup,
    ok: findings.every((item) => item.severity !== 'error'),
    findings,
  })
}

function staleArtifactsFinding(): SetupFinding {
  return {
    contributorId: 'runtime-artifacts',
    code: 'RUNTIME_ARTIFACTS_STALE',
    resource: 'generated-runtime-files',
    severity: 'warning',
    message: 'Generated Runtime files are not current for this project.',
    remediation: 'Run `crux setup --apply` to refresh them safely.',
  }
}

function aggregateGenerationFinding(
  error: RuntimeArtifactGenerationError,
): SetupFinding {
  const actionable = error.findings.some((finding) => finding.remediation)
  const docsUrl = error.findings.find((finding) => finding.docs)?.docs
  return {
    contributorId: 'runtime-artifacts',
    code: error.code,
    resource: 'generated-runtime-files',
    severity: 'error',
    message: `Runtime files could not be prepared (${error.findings.length} ${error.findings.length === 1 ? 'issue' : 'issues'}).`,
    ...(actionable
      ? { remediation: 'Follow the Runtime artifact fixes shown below.' }
      : {}),
    ...(docsUrl ? { docsUrl } : {}),
  }
}

function projectPath(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, '/').replace(/^\.\//, '')
}

function configFailureContributor() {
  return defineSetupContributor({
    id: 'project-config',
    inspect: async () => [
      {
        contributorId: 'project-config',
        code: 'SETUP_CONTRIBUTOR_FAILED',
        resource: 'crux.config',
        severity: 'error',
        message: 'The Crux project configuration could not be loaded.',
        remediation:
          'Fix the configuration import error, then rerun `crux setup`.',
      },
    ],
    plan: async () => [],
  })
}
