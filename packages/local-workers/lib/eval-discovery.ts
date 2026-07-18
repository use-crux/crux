/** Worker test adapter for the Core-owned Node discovery contract. */

import * as nodeRunner from '@use-crux/core/eval/internal/node-runner'
import type * as EvalRunnerCore from '@use-crux/core/eval/internal/runner'

export type EvalRunner = typeof EvalRunnerCore
export type {
  DiscoveredEval,
  EvalDiscoveryError,
  EvalDiscoveryResult,
  EvalModule,
} from '@use-crux/core/eval/internal/node-runner'

export function discoverProjectEvals(options: {
  readonly projectRoot: string
  readonly core: EvalRunner
}) {
  return nodeRunner.discoverProjectEvals(options.projectRoot)
}

export function collectEvalModules(options: {
  readonly projectRoot: string
  readonly core: EvalRunner
  readonly modules: readonly nodeRunner.EvalModule[]
}) {
  return nodeRunner.collectEvalModules(options.modules)
}

export const deriveEvalId = nodeRunner.deriveEvalId
export const siblingCaseFile = nodeRunner.siblingCaseFile

export function selectEvals<T extends {
  readonly id: string
  readonly sourceKey: { readonly relativeFile: string; readonly export: 'default' }
  readonly links?: readonly string[]
}>(evals: readonly T[], selectors: readonly string[]) {
  const selected = nodeRunner.selectEvals(evals, selectors)
  return {
    matches: selected.matches,
    errors: selected.errors.map((message, index) => ({
      selector: selectors[index] ?? selectors[0] ?? '',
      message: message.replace(/runEval\('([^']+)'\)/g, 'crux eval $1'),
    })),
  }
}
