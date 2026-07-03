/**
 * Runtime adapter setup contract.
 *
 * Setup ports let tooling verify or add Crux-owned resources. `check()` must
 * never mutate infrastructure. `apply()` may create safe additive resources
 * only and must be idempotent under concurrent deploys.
 *
 * @module
 */

/** Runtime setup mode requested by tooling or adapter options. */
export type RuntimeSetupMode = 'verify' | 'create-if-missing'

/** Options for non-mutating runtime setup checks. */
export interface RuntimeSetupOptions {
  /** Expected setup mode for diagnostics. */
  readonly mode?: RuntimeSetupMode
}

/** Options for additive setup application. */
export interface RuntimeSetupApplyOptions extends RuntimeSetupOptions {
  /** Require an explicit apply acknowledgement in production tooling. */
  readonly confirm?: boolean
}

/** Single setup diagnostic finding. */
export interface RuntimeSetupFinding {
  /** Stable runtime diagnostic code. */
  readonly code: string
  /** Resource or capability that failed validation. */
  readonly resource: string
  /** Human-readable explanation. */
  readonly message: string
  /** Copy-pasteable remediation command or SQL, when available. */
  readonly remediation?: string
}

/** Result of a setup check or additive apply. */
export interface RuntimeSetupResult {
  /** Whether all required resources are present and compatible. */
  readonly ok: boolean
  /** Findings that tooling should render to the user. */
  readonly findings: readonly RuntimeSetupFinding[]
}

/** Optional adapter-owned resource verification/provisioning port. */
export interface RuntimeSetupPort {
  /**
   * Verify required runtime resources without mutating infrastructure.
   *
   * Missing resources must be listed with exact remediation. Driver errors
   * should be wrapped into stable runtime diagnostics by the caller.
   */
  check(options?: RuntimeSetupOptions): Promise<RuntimeSetupResult>

  /**
   * Apply safe additive runtime setup.
   *
   * Destructive migrations are never automatic. This method must be idempotent
   * when called concurrently by multiple deploys.
   */
  apply(options?: RuntimeSetupApplyOptions): Promise<RuntimeSetupResult>
}
