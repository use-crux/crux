/**
 * Compare operation for the Quality runner facade.
 *
 * @internal
 * @module
 */

import { readFile } from 'node:fs/promises'
import { compareExperiments } from './experiment-diff'
import type { QualityCompareInput } from './runner-types'
import { experimentRecordSchema } from '../schemas'
import type { ExperimentDiff, ExperimentRecord } from '../schema-types'

/** Load optional record paths and delegate to the core diff policy. */
export async function compareQualityExperiments(input: QualityCompareInput): Promise<ExperimentDiff> {
  return compareExperiments(await resolveExperimentRecord(input.a), await resolveExperimentRecord(input.b))
}

async function resolveExperimentRecord(input: string | ExperimentRecord): Promise<ExperimentRecord> {
  if (typeof input !== 'string') return input
  return experimentRecordSchema.parse(JSON.parse(await readFile(input, 'utf8')) as unknown)
}
