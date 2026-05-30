/**
 * `@crux/core/flow` — Flow evaluation and runtime flow scoping.
 *
 * **Evaluation:**
 * Test tool-calling loops, prompt chains, and multiturn conversations
 * with per-step model comparison.
 *
 * **Runtime:**
 * Use `flow()` to create named flow handles with `.run()` and `.signal()`,
 * grouping `generate()` calls into structured pipelines with named steps,
 * automatic devtools tracing, suspend/resume, and retry/fallback.
 *
 * @example
 * ```ts
 * import { flow } from '@crux/core'
 * import { generate } from '@crux/ai'
 *
 * const researchFlow = flow('research', async (flow) => {
 *   const plan = await flow.step('plan', () => generate(planner, { model, input }))
 *   return flow.step('search', () => generate(searcher, { model, input: plan }))
 * })
 *
 * const result = await researchFlow.run()
 * ```
 *
 * @module
 */

export { executeFlow, type ExecuteFlowOptions } from './executor'
export { evaluateFlow, type EvaluateFlowOptions } from './evaluator'

// Types and error classes (decomposed from scope.ts)
export { FlowSuspendedError, FlowCancelledError, FlowExpiredError } from './types'
export type {
  FlowHandle,
  FlowRunOptions,
  FlowScope,
  FlowResult,
  FlowSnapshot,
  FlowSummary,
  ListFlowsOptions,
  SuspendOptions,
  StepOptions,
  WithFlowOptions,
} from './types'

// Lifecycle utilities (decomposed from scope.ts)
export { createFlowId, signalFlow, cancelFlow, getFlowSnapshot, listFlows } from './lifecycle'

// Flow execution engine
export { flow } from './scope'
