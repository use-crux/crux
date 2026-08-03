import type { GenerationCapabilities } from "./capabilities";
import type { GenerationRuntimePort } from "./runtime-port";
import { generationRuntime } from "./runtime-port";

/** Stable adapter execution identity for durable compatibility checks. */
export interface GenerationAdapterIdentity {
  readonly id: string;
  readonly version: string;
}

/** Secret-free logical identity and semantic compatibility fingerprint. */
export interface GenerationModelDefinition {
  readonly id: string;
  readonly fingerprint: string;
}

/** Provider-neutral normalized identity for a model or same-adapter router. */
export type NormalizedGenerationIdentity =
  | { readonly kind: "model"; readonly model: string }
  | {
      readonly kind: "router";
      readonly router: string;
      readonly routes: readonly {
        readonly key: string;
        readonly target: string;
      }[];
    };

/** Frozen adapter-bound model carrying opaque execution authority. */
export interface AdapterBoundGenerationModel<
  TNative = unknown,
  TCapabilities extends GenerationCapabilities = GenerationCapabilities,
> {
  readonly _tag: "crux.generation-model";
  readonly adapter: GenerationAdapterIdentity;
  readonly native: TNative;
  readonly definition: GenerationModelDefinition;
  readonly identity: NormalizedGenerationIdentity;
  readonly capabilities: TCapabilities;
  readonly [generationRuntime]: GenerationRuntimePort;
}

/** Provider-neutral model accepted by durable generation consumers. */
export type GenerationModel = AdapterBoundGenerationModel;
