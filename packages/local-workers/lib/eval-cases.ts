/** Worker test adapter for Core-owned Node Case hydration. */

import * as nodeRunner from '@use-crux/core/eval/internal/node-runner'
import type { EvalRunner } from './eval-discovery'

export { EvalCaseFileError } from '@use-crux/core/eval/internal/node-runner'
export type {
  HydratedEval,
  LoadedEvalCase,
} from '@use-crux/core/eval/internal/node-runner'

type CoreHydrationOptions = Parameters<typeof nodeRunner.hydrateEvalCases>[1]
type CoreLoadOptions = Parameters<typeof nodeRunner.loadCaseRows>[0]

export interface EvalCaseHydrationOptions extends CoreHydrationOptions {
  readonly core: EvalRunner
}

export interface LoadCaseRowsOptions extends CoreLoadOptions {
  readonly core: EvalRunner
}

export function hydrateEvalCases(
  discovered: Parameters<typeof nodeRunner.hydrateEvalCases>[0],
  options: EvalCaseHydrationOptions,
) {
  const { core: _core, ...shared } = options
  return nodeRunner.hydrateEvalCases(discovered, shared)
}

export function loadCaseRows(options: LoadCaseRowsOptions) {
  const { core: _core, ...shared } = options
  return nodeRunner.loadCaseRows(shared)
}
