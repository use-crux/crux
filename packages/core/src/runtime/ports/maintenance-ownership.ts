/** Provider-neutral ownership contracts for exclusive Runtime maintenance. */

/** Exclusive durable ownership successfully acquired for Runtime maintenance. */
export interface RuntimeMaintenanceOwnershipLease {
  /** Whether this result owns maintenance for the requested namespace. */
  readonly acquired: true
  /** Rejects when the backing ownership mechanism is lost unexpectedly. */
  readonly lost?: Promise<never>
  /** Release this lease; repeated calls must be safe and have no additional effect. */
  readonly release: () => Promise<void>
}

/** Result returned when another worker already owns Runtime maintenance. */
export interface RuntimeMaintenanceOwnershipUnavailable {
  /** Whether this result owns maintenance for the requested namespace. */
  readonly acquired: false
}

/** Result of attempting to acquire durable Runtime maintenance ownership. */
export type RuntimeMaintenanceOwnershipResult =
  | RuntimeMaintenanceOwnershipLease
  | RuntimeMaintenanceOwnershipUnavailable

/** Optional store capability for cross-process Runtime maintenance exclusion. */
export interface RuntimeMaintenanceOwnershipPort {
  /**
   * Attempt to exclusively own maintenance for one Runtime namespace.
   *
   * @param namespace - Runtime namespace requiring a single maintenance owner.
   * @returns An acquired lease or an explicit unavailable result.
   */
  acquire(namespace: string): Promise<RuntimeMaintenanceOwnershipResult>
}
