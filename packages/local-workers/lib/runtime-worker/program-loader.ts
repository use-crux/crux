import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRuntimeError, type RuntimeArtifactManifest, type RuntimeProgram } from '@use-crux/core/runtime'
import {
  decodeRuntimeArtifactManifest,
  RuntimeArtifactManifestDecodeError,
} from '@use-crux/indexer/host/runtime'
import { importUserModule } from '@use-crux/indexer/internal/user-import'

const PROGRAM_FILE = '.crux/generated/runtime/program.ts'
const MANIFEST_FILE = '.crux/generated/runtime/manifest.json'
const PROGRAM_FORMAT = 'crux-runtime-program:v1'

/** Load and validate the single generated Runtime program for a project. */
export async function loadGeneratedRuntimeProgram(root: string): Promise<RuntimeProgram> {
  const programFile = join(root, PROGRAM_FILE)
  try {
    await access(programFile)
  } catch (cause) {
    throw createRuntimeError({
      code: 'SETUP_REQUIRED',
      whatFailed: `Crux could not find the generated Runtime program at \`${PROGRAM_FILE}\`.`,
      why: 'The project has not generated Runtime artifacts, or they were removed.',
      whatStillWorks: 'Application code and non-worker Runtime commands are unchanged.',
      nextStep: 'Run `crux runtime generate`, then retry `crux runtime worker`.',
      cause,
    })
  }
  let manifest: string
  try {
    manifest = await readFile(join(root, MANIFEST_FILE), 'utf8')
  } catch (cause) {
    throw artifactError('SETUP_REQUIRED', `Crux could not find \`${MANIFEST_FILE}\`.`, cause)
  }
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifest)
  } catch (cause) {
    throw artifactError('RUNTIME_ARTIFACT_MANIFEST_INVALID', 'The generated Runtime manifest is not valid JSON.', cause)
  }
  let decodedManifest: RuntimeArtifactManifest
  try {
    decodedManifest = decodeRuntimeArtifactManifest(manifestValue)
  } catch (cause) {
    if (!(cause instanceof RuntimeArtifactManifestDecodeError)) throw cause
    throw artifactError(
      cause.code === 'version_incompatible'
        ? 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE'
        : 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
      cause.message,
      cause,
    )
  }
  let imported: Record<string, unknown>
  try {
    imported = await importUserModule(programFile, 8_000, root)
  } catch (cause) {
    throw artifactError(
      'RUNTIME_ARTIFACT_MANIFEST_INVALID',
      `Crux could not import the generated Runtime program at \`${PROGRAM_FILE}\`.`,
      cause,
    )
  }
  if (imported.runtimeProgramFormat !== PROGRAM_FORMAT) {
    throw artifactError(
      'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
      'The generated Runtime program uses an incompatible format.',
    )
  }
  const actualHash = createHash('sha256').update(manifest).digest('hex')
  if (imported.runtimeArtifactManifestHash !== actualHash) {
    throw artifactError(
      'ARTIFACTS_STALE',
      'The generated Runtime program does not match its manifest.',
    )
  }
  if (!isRuntimeProgram(imported.runtimeProgram)) {
    throw artifactError(
      'RUNTIME_ARTIFACT_MANIFEST_INVALID',
      'The generated Runtime module did not export a valid `runtimeProgram`.',
    )
  }
  if (!programTargetsMatchManifest(imported.runtimeProgram, decodedManifest)) {
    throw artifactError(
      'ARTIFACTS_STALE',
      'The generated Runtime program targets do not match the Runtime manifest.',
    )
  }
  return imported.runtimeProgram
}

function isRuntimeProgram(value: unknown): value is RuntimeProgram {
  return (
    typeof value === 'object' &&
    value !== null &&
    'manifestHash' in value &&
    typeof value.manifestHash === 'string' &&
    'targets' in value &&
    Array.isArray(value.targets) &&
    'transports' in value &&
    Array.isArray(value.transports)
  )
}

function programTargetsMatchManifest(
  program: RuntimeProgram,
  manifest: RuntimeArtifactManifest,
): boolean {
  const actual = program.targets.map(programTargetIdentity)
  if (actual.some((target) => target === undefined)) return false
  const expected = manifest.targets.map(({ name, kind }) => ({ name, kind }))
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function programTargetIdentity(
  target: RuntimeProgram['targets'][number],
): { readonly name: string; readonly kind: 'flow' | 'task' } | undefined {
  if ('kind' in target && (target.kind === 'flow' || target.kind === 'task')) {
    const name = 'name' in target ? target.name : target.targetId
    return typeof name === 'string' ? { name, kind: target.kind } : undefined
  }
  return 'name' in target && typeof target.name === 'string'
    ? { name: target.name, kind: 'flow' }
    : undefined
}

function artifactError(
  code: 'SETUP_REQUIRED' | 'ARTIFACTS_STALE' | 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE' | 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
  whatFailed: string,
  cause?: unknown,
) {
  return createRuntimeError({
    code,
    whatFailed,
    why: 'The worker only executes one complete, current Crux-generated Runtime artifact set.',
    whatStillWorks: 'The application and existing Runtime data remain unchanged.',
    nextStep: 'Run `crux runtime generate`, fix any reported import error, then retry `crux runtime worker`.',
    cause,
  })
}
