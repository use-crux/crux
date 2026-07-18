/** Stable fail-closed categories for generated Eval registry resolution. */
export type DeployedEvalRegistryErrorCode =
  | "registry_invalid"
  | "index_disagreement"
  | "eval_missing"
  | "eval_stale"
  | "case_missing"
  | "case_stale"
  | "variant_missing"
  | "variant_stale";

/** Configuration or identity failure raised before deployed task execution. */
export class DeployedEvalRegistryError extends Error {
  override readonly name = "DeployedEvalRegistryError";

  constructor(
    readonly code: DeployedEvalRegistryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function registryError(
  code: DeployedEvalRegistryErrorCode,
  message: string,
): never {
  throw new DeployedEvalRegistryError(code, message);
}
