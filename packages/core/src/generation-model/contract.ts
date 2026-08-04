import type { GenerationCapabilities } from "./capabilities";
import type { GenerationRuntimePort } from "./runtime-port";
import { generationRuntime } from "./runtime-port";

/**
 * Stable adapter execution identity for durable compatibility checks.
 *
 * @remarks Version is a semantic adapter execution-contract version, not a
 * package version string.
 */
export interface GenerationAdapterIdentity {
  readonly id: string;
  readonly version: string;
}

/**
 * Secret-free logical identity and semantic compatibility fingerprint.
 *
 * @remarks Durable Agent Sessions pin only these two fields in stored state.
 */
export interface GenerationModelDefinition {
  readonly id: string;
  readonly fingerprint: string;
}

/**
 * Provider-neutral normalized identity for a model or same-adapter router.
 *
 * @remarks Never includes credentials, endpoints, or provider-native objects.
 */
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

/**
 * Frozen adapter-bound model carrying opaque execution authority.
 *
 * @typeParam TNative - Adapter-native model or same-adapter route tree.
 * @typeParam TCapabilities - Exact capability evidence retained from binding.
 * @remarks Constructed only through adapter-authoring
 * `defineGenerationModel` / package helpers such as `aiSdk(native)`.
 */
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

/**
 * Provider-neutral model accepted by durable generation consumers.
 *
 * @remarks Required by durable Agent Sessions and declared on Runtime programs.
 */
export type GenerationModel = AdapterBoundGenerationModel;
