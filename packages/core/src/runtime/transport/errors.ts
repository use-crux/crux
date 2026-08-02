/** Raised when inert managed-transport contract data is not safe or well-formed. */
export class RuntimeManagedTransportContractError extends Error {
  /** Stable error discriminator for callers that need to report invalid declarations. */
  readonly code = "RUNTIME_MANAGED_TRANSPORT_CONTRACT_INVALID" as const;

  constructor(
    /** Location of the invalid value within the submitted declaration. */
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "RuntimeManagedTransportContractError";
  }
}
