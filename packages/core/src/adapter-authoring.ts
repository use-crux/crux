/** Adapter-only construction surface for portable generation models. */
export { defineGenerationModel } from "./generation-model/define-generation-model";
export type { GenerationModelSpec } from "./generation-model/define-generation-model";
export type { GenerationRuntimePort } from "./generation-model/runtime-port";
export {
  managedGenerationCheckpoint,
  type ManagedGenerationCheckpoint,
  managedGenerationStepBoundary,
  type ManagedGenerationStepBoundary,
  type ManagedGenerationStepBoundaryInput,
  type ManagedGenerationStepBoundaryResult,
  type ManagedGenerationStepIngress,
} from "./generation-model/execution-checkpoint";
