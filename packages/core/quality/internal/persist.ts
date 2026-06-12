/**
 * Experiment persistence — writes the versioned Experiment record (spec 02
 * §1) to `<dir>/experiments/<experimentId>.json`.
 *
 * The persisted JSON mirrors the typed `Experiment` field-for-field with two
 * differences: the cell array is named `cases` (record contract) and the
 * `promote()` method is not data. Records are gitignored by default;
 * baselines (Phase 4) are the committed artifact.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Experiment } from '../experiment'

/** Convert a typed Experiment into the persisted record shape. @internal */
export function toExperimentRecord(experiment: Experiment<unknown, unknown, string, string>): Record<string, unknown> {
  const { perCase, promote: _promote, ...rest } = experiment
  return { ...rest, cases: perCase }
}

/**
 * Write the experiment record under `<dir>/experiments/`. Creates the
 * directory on first use.
 *
 * @returns The absolute path of the written record.
 *
 * @internal
 */
export async function persistExperiment(
  experiment: Experiment<unknown, unknown, string, string>,
  dir: string,
): Promise<string> {
  const experimentsDir = join(dir, 'experiments')
  await mkdir(experimentsDir, { recursive: true })
  const path = join(experimentsDir, `${experiment.experimentId}.json`)
  await writeFile(path, `${JSON.stringify(toExperimentRecord(experiment), null, 2)}\n`, 'utf8')
  return path
}
