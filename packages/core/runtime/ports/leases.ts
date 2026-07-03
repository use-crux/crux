/**
 * Durable lease port contract.
 *
 * Leases prevent concurrent workers from actively mutating the same resource.
 * They are not a substitute for idempotency; the kernel must still check the
 * idempotency key after a lease is acquired.
 *
 * @module
 */

import type { LeaseToken } from './ids'

/** Runtime resource name protected by a lease, such as `work:01J...`. */
export type LeaseResource = string

/** Options for claiming a runtime lease. */
export interface ClaimOptions {
  /** Lease lifetime in milliseconds. */
  readonly ttlMs: number
  /** Optional worker/process identifier for diagnostics. */
  readonly ownerId?: string
}

/** Durable lease record proving exclusive ownership until `expiresAt`. */
export interface Lease {
  /** Leased runtime resource. */
  readonly resource: LeaseResource
  /** Opaque adapter-generated lease token. */
  readonly token: LeaseToken
  /** Expiry time after which maintenance may reclaim the resource. */
  readonly expiresAt: Date
  /** Optional owner/process identifier. */
  readonly ownerId?: string
}

/** Durable lease port for concurrent runtime workers. */
export interface LeasePort {
  /**
   * Claim a lease if the resource is free or expired.
   *
   * May be called concurrently by multiple workers. Exactly one caller should
   * receive a lease for the same unexpired resource.
   */
  claim(resource: LeaseResource, options: ClaimOptions): Promise<Lease | null>

  /**
   * Extend a currently-owned lease.
   *
   * The adapter generates and returns the refreshed lease metadata. Extension
   * failures are retryable only when caused by transient storage errors.
   */
  extend(lease: Lease, ttlMs: number): Promise<Lease>

  /**
   * Release a lease after the kernel has committed or abandoned work.
   *
   * Release is idempotent; an already-expired or already-released lease is a
   * no-op from the kernel's perspective.
   */
  release(lease: Lease): Promise<void>
}
