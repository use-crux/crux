/**
 * Failed-cell rerun selection for the Quality runner facade.
 *
 * Tooling asks for a previous experiment (`latest` or an explicit id); this
 * module reads the persisted record and returns exact case × variant pairs.
 * Keeping this out of the engine avoids making persisted-record lookup part
 * of cell execution.
 *
 * @internal
 * @module
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunCellSelection } from '../experiment'
import type { ExperimentRecord } from '../schema-types'
import { QualityDefinitionError } from './engine'
import { experimentRecordPath } from './persist'

/** Resolve `--failed` into exact cell selectors for one evaluation. */
export async function resolveFailedCellSelection(input: {
  dir: string
  evaluationId: string
  failed: string
}): Promise<readonly RunCellSelection<string>[]> {
  const record = await readFailedReferenceRecord(input)
  const seen = new Set<string>()
  const cells: RunCellSelection<string>[] = []
  for (const cell of record.cells) {
    if (cell.status !== 'failed' && cell.status !== 'errored') continue
    const key = `${cell.caseId}\u0000${cell.variantName}`
    if (seen.has(key)) continue
    seen.add(key)
    cells.push({ caseId: cell.caseId, variantName: cell.variantName })
  }
  return cells
}

async function readFailedReferenceRecord(input: {
  dir: string
  evaluationId: string
  failed: string
}): Promise<ExperimentRecord> {
  if (input.failed !== 'latest') {
    return readExperimentRecord(input.dir, input.failed)
  }
  const latest = await latestExperimentIdForEvaluation(input.dir, input.evaluationId)
  if (latest === undefined) {
    throw new QualityDefinitionError(`--failed latest found no previous experiment for '${input.evaluationId}'.`)
  }
  return readExperimentRecord(input.dir, latest)
}

async function latestExperimentIdForEvaluation(dir: string, evaluationId: string): Promise<string | undefined> {
  let files: string[]
  try {
    files = await readdir(join(dir, 'experiments'))
  } catch {
    return undefined
  }
  const matches: string[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const experimentId = file.slice(0, -'.json'.length)
    try {
      const record = await readExperimentRecord(dir, experimentId)
      if (record.evaluationId === evaluationId) matches.push(record.experimentId)
    } catch {
      continue
    }
  }
  return matches.sort().at(-1)
}

async function readExperimentRecord(dir: string, experimentId: string): Promise<ExperimentRecord> {
  const path = experimentRecordPath(dir, experimentId)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ExperimentRecord
    if (parsed.schemaVersion !== 2 || typeof parsed.evaluationId !== 'string' || !Array.isArray(parsed.cells)) {
      throw new Error('missing required experiment record fields')
    }
    return parsed
  } catch (error) {
    throw new QualityDefinitionError(
      `--failed could not read experiment '${experimentId}' at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
