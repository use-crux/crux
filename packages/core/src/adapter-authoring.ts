/** Adapter-only construction surface for portable generation models. */
export { defineGenerationModel } from "./generation-model/define-generation-model";
export type { GenerationModelSpec } from "./generation-model/define-generation-model";
export type { GenerationRuntimePort } from "./generation-model/runtime-port";
export {
  managedGenerationCheckpoint,
  type ManagedGenerationCheckpoint,
} from "./generation-model/execution-checkpoint";
