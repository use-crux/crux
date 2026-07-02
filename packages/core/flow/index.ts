/**
 * `@use-crux/core/flow` — runtime flow scoping.
 *
 * Use `flow()` to create named flow handles with `.run()` and `.signal()`,
 * grouping `generate()` calls into structured pipelines with named steps,
 * automatic devtools tracing, suspend/resume, and retry/fallback.
 *
 * Flows are evaluated with the Quality system: wrap a handle in
 * `evaluate({ task: myFlow, ... })` from `@use-crux/core/quality`.
 *
 * @example
 * ```ts
 * import { flow } from '@use-crux/core'
 * import { generate } from '@use-crux/ai'
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

// Types and error classes (decomposed from scope.ts)
export { FlowSuspendedError, FlowCancelledError, FlowExpiredError } from './types'
export { FlowSerializationError } from './serialization'
export type { FlowPersistenceBoundary } from './serialization'
export type {
  FlowHandle,
  FlowResumeOptions,
  FlowRunOptions,
  FlowScope,
  FlowSignalOptions,
  FlowResult,
  FlowSnapshot,
  FlowSummary,
  ListFlowsOptions,
  SuspendOptions,
  StepOptions,
} from './types'
export { InvalidSignalPayloadError, noPayload } from './signals'
export type {
  FlowDefinitionOptions,
  FlowSignalMap,
  FlowSignalPayload,
  FlowSignalSpec,
  NoPayloadSignal,
} from './signals'

// Lifecycle utilities (decomposed from scope.ts)
export { createFlowId, signalFlow, cancelFlow, getFlowSnapshot, listFlows } from './lifecycle'

// Flow execution engine
export { flow } from './scope'
