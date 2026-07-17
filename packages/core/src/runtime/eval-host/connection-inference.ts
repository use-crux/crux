import type { HostBoundRuntimeEngineDefinition } from "../api/runtime-definition";

const EVAL_HOST_CONNECTION_INFERENCE = Symbol.for(
  "@use-crux/core/eval-host/connection-inference",
);

export interface EvalHostConnectionDefaults {
  /** Adapter-standard non-secret Runtime URL, when known. */
  readonly url?: string;
  /** Adapter-standard non-secret deployment identity, when known. */
  readonly deploymentId?: string;
}

/** Provider-neutral adapter hook for platform-standard connection variables. */
export interface EvalHostConnectionInference {
  infer(
    environment: Readonly<Record<string, string | undefined>>,
  ): EvalHostConnectionDefaults;
}

/** Attach non-secret coordinator inference to an inert host declaration. */
export function attachEvalHostConnectionInference<
  TDefinition extends HostBoundRuntimeEngineDefinition,
>(
  definition: TDefinition,
  inference: EvalHostConnectionInference,
): TDefinition {
  Object.defineProperty(definition, EVAL_HOST_CONNECTION_INFERENCE, {
    value: Object.freeze(inference),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(definition);
}

/** Read the selected adapter's optional non-secret inference port. */
export function getEvalHostConnectionInference(
  definition: unknown,
): EvalHostConnectionInference | undefined {
  if (typeof definition !== "object" || definition === null) return undefined;
  const value = (definition as Record<PropertyKey, unknown>)[
    EVAL_HOST_CONNECTION_INFERENCE
  ];
  return isInference(value) ? value : undefined;
}

function isInference(value: unknown): value is EvalHostConnectionInference {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<EvalHostConnectionInference>).infer === "function"
  );
}
