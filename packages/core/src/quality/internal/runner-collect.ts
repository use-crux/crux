/**
 * Collection implementation for the Quality runner facade.
 *
 * Collection scans already-imported modules and prompt candidates. It never
 * executes tasks, scorers, or assertions; it only normalizes live evaluation
 * handles into manifests and collect-time ids.
 *
 * @internal
 * @module
 */

import type { AnyPrompt } from '../../prompt/prompt-types'
import type { Evaluation } from '../evaluate'
import { getEvaluationDefinition } from '../evaluate'
import type { EvaluationManifest } from '../manifest'
import { hasPromptTests, lowerPromptTests } from './prompt-tests'
import type {
  QualityCollectedEvaluation,
  QualityCollectError,
  QualityCollectInput,
  QualityCollectResult,
  QualityEventSink,
} from './runner-types'
import { createQualityEvaluationHandle } from './runner-types'

/** Collect evaluation exports and colocated prompt tests behind opaque handles. */
export async function collectQualityEvaluations(
  input: QualityCollectInput,
  emit?: QualityEventSink,
): Promise<QualityCollectResult> {
  const evaluations: QualityCollectedEvaluation[] = []
  const errors: QualityCollectError[] = []

  for (const moduleInput of input.modules ?? []) {
    const file = moduleInput.file?.replaceAll('\\', '/') ?? ''
    for (const [exportName, value] of Object.entries(moduleInput.exports)) {
      if (isThenable(value)) {
        errors.push({
          message:
            `${file || '<inline>'} export '${exportName}' is a Promise — evaluations must be defined ` +
            `synchronously at module top level (async-at-collect). Define the evaluation with evaluate() and ` +
            `load slow resources via dataset() or eval-local helpers.`,
          ...(file !== '' ? { file } : {}),
        })
        continue
      }
      if (!isEvaluationValue(value)) continue
      evaluations.push(collectEvaluationValue(value, { file, exportName, source: 'file' }))
    }
  }

  const promptResult = collectPromptTestCandidates(input.promptCandidates ?? [])
  evaluations.push(...promptResult.evaluations)
  errors.push(...promptResult.errors)
  if (input.validateDuplicateIds !== false) {
    errors.push(...findDuplicateQualityIdErrors(evaluations))
  }

  emit?.({ type: 'collect:done', evaluations: evaluations.map((entry) => entry.manifest), errors })
  return { evaluations, errors }
}

/** Lower prompt tests into collected evaluations. */
function collectPromptTestCandidates(prompts: readonly AnyPrompt[]): QualityCollectResult {
  const evaluations: QualityCollectedEvaluation[] = []
  const errors: QualityCollectError[] = []

  for (const candidate of prompts) {
    if (!hasPromptTests(candidate)) continue
    try {
      evaluations.push(
        collectEvaluationValue(lowerPromptTests(candidate), {
          file: '',
          exportName: '',
          source: 'prompt-tests',
        }),
      )
    } catch (error) {
      errors.push({ message: describeError(error) })
    }
  }

  return { evaluations, errors }
}

function collectEvaluationValue(
  evaluation: Evaluation,
  fields: { file: string; exportName: string; source: 'file' | 'prompt-tests' },
): QualityCollectedEvaluation {
  const definition = getEvaluationDefinition(evaluation)
  const explicitId = typeof evaluation.id === 'string' && evaluation.id.length > 0
  const id = explicitId ? evaluation.id : deriveEvaluationId(fields.file, fields.exportName)
  const manifest = fillManifest(evaluation.manifest, {
    id,
    explicitId,
    file: fields.file,
    exportName: fields.exportName,
  })
  const handle = createQualityEvaluationHandle({
    evaluation,
    definition,
  })

  return Object.freeze({
    id,
    explicitId,
    file: fields.file,
    exportName: fields.exportName,
    source: fields.source,
    manifest,
    handle,
  })
}

function fillManifest(
  manifest: EvaluationManifest,
  fields: { id: string; explicitId: boolean; file: string; exportName: string },
): EvaluationManifest {
  return { ...manifest, ...fields }
}

function isEvaluationValue(value: unknown): value is Evaluation {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { _tag?: unknown })._tag === 'CruxEvaluation' &&
    typeof (value as { run?: unknown }).run === 'function'
  )
}

function isThenable(value: unknown): boolean {
  return value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
}

/** Derive the collection id for an evaluation that did not pin one in source. */
export function deriveEvaluationId(relFile: string, exportName: string): string {
  const posix = relFile.replaceAll('\\', '/')
  const withoutExt = posix.replace(/\.eval\.[cm]?[jt]sx?$/, '').replace(/\.[cm]?[jt]sx?$/, '')
  const base = withoutExt.replaceAll('/', '.')
  return exportName === 'default' ? base : `${base}#${exportName}`
}

/** Duplicate ids are collect-time definition errors. */
export function findDuplicateQualityIdErrors(
  evaluations: readonly QualityCollectedEvaluation[],
): QualityCollectError[] {
  const byId = new Map<string, QualityCollectedEvaluation[]>()
  for (const entry of evaluations) {
    const bucket = byId.get(entry.id)
    if (bucket) bucket.push(entry)
    else byId.set(entry.id, [entry])
  }

  const errors: QualityCollectError[] = []
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue
    const locations = entries.map((entry) => (entry.file === '' ? `prompt:${id}` : `${entry.file}#${entry.exportName}`))
    errors.push({
      message: `Duplicate evaluation id '${id}' defined in: ${locations.join(', ')}. Ids must be unique across the project.`,
      ...(entries[0]!.file !== '' ? { file: entries[0]!.file } : {}),
    })
  }
  return errors
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
