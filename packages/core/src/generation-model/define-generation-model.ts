import {
  freezeGenerationCapabilities,
  type GenerationCapabilities,
} from "./capabilities";
import type {
  AdapterBoundGenerationModel,
  GenerationAdapterIdentity,
  GenerationModelDefinition,
  NormalizedGenerationIdentity,
} from "./contract";
import {
  freezeAdapterIdentity,
  freezeModelDefinition,
  freezeNormalizedIdentity,
} from "./identity";
import { generationRuntime, type GenerationRuntimePort } from "./runtime-port";

/** Complete adapter-owned specification for defining a GenerationModel. */
export interface GenerationModelSpec<
  TNative,
  TCapabilities extends GenerationCapabilities,
> {
  /** Adapter identity exposed by the model. */
  readonly adapter: GenerationAdapterIdentity;
  /** Adapter-native model value. */
  readonly native: TNative;
  /** Provider-neutral model definition. */
  readonly definition: GenerationModelDefinition;
  /** Normalized identity used for comparison and persistence. */
  readonly identity: NormalizedGenerationIdentity;
  /** Provider-neutral capabilities supported by the model. */
  readonly capabilities: TCapabilities;
  /** Opaque runtime authority used to execute the model. */
  readonly runtime: GenerationRuntimePort;
}

/** Install frozen Core metadata and opaque authority for one adapter model. */
export function defineGenerationModel<
  const TNative,
  const TCapabilities extends GenerationCapabilities,
>(
  spec: GenerationModelSpec<TNative, TCapabilities>,
): AdapterBoundGenerationModel<TNative, TCapabilities> {
  if (!spec.runtime || typeof spec.runtime.createAgentExecutor !== "function") {
    throw new TypeError("Generation model runtime authority is invalid.");
  }
  const model = {
    _tag: "crux.generation-model" as const,
    adapter: freezeAdapterIdentity(spec.adapter),
    native: spec.native,
    definition: freezeModelDefinition(spec.definition),
    identity: freezeNormalizedIdentity(spec.identity),
    capabilities: freezeGenerationCapabilities(spec.capabilities),
  };
  Object.defineProperty(model, generationRuntime, {
    value: spec.runtime,
    enumerable: false,
  });
  return Object.freeze(model) as AdapterBoundGenerationModel<
    TNative,
    TCapabilities
  >;
}
