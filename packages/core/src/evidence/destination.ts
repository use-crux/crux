/**
 * Provider-neutral readable evidence destination contract.
 *
 * @module
 */

import type { EvidenceConclusion, EvidenceRole } from "./roles";
import type { EvidenceRecord } from "./record-types";
import type { EvidenceSubject } from "./subjects";
import type {
  EvidenceExplicitCoverageStatus,
  EvidenceRoleStatus,
} from "./view-types";

/** Frozen query captured by `evidence.inspect()` before its first await. */
export interface EvidenceDestinationInspectRequest {
  /** Exact subject requested by the caller. */
  readonly subject: EvidenceSubject;
  /** Only role permitted to hydrate rows and return a cursor. */
  readonly role?: EvidenceRole;
  /** Maximum rows hydrated per selected role. */
  readonly limit: number;
  /** Opaque destination-owned continuation. */
  readonly cursor?: string;
  /** Whether superseded rows may be hydrated. */
  readonly includeHistory: boolean;
  /** Whether authorized safe inline data may be hydrated. */
  readonly includeData: boolean;
}

/** Destination rows and authoritative aggregate for one role. */
export interface EvidenceDestinationRoleResult<R extends EvidenceRole> {
  /** Fixed role described by this result. */
  readonly role: R;
  /**
   * Complete authorized durable status for this role.
   *
   * @remarks Computed from the complete active set before hydration,
   * pagination, and history selection. `"present"` does not guarantee that
   * inline data is retained, authorized, or included in this response.
   */
  readonly status: EvidenceRoleStatus;
  /**
   * Exact count of authorized, retained, active relationships for this role.
   *
   * @remarks Computed before hydration, pagination, and history selection.
   * Superseded relationships and explicit coverage facts are excluded.
   */
  readonly activeRecordCount: number;
  /** Active hydrated rows, bounded by the request. */
  readonly records: readonly EvidenceRecord<R>[];
  /** Superseded hydrated rows when history was requested. */
  readonly history?: readonly EvidenceRecord<R>[];
  /** Explicit non-present coverage fact, never a default missing state. */
  readonly coverage?: EvidenceExplicitCoverageStatus;
  /** Aggregate conclusion across the complete authorized visible set. */
  readonly conclusion?: EvidenceConclusion<R>;
  /** Whether the complete authorized set contains incompatible conclusions. */
  readonly conflicting: boolean;
  /** Whether the authorized result set or hydrated rows are incomplete. */
  readonly truncated: boolean;
  /** Opaque continuation, valid only for the selected role. */
  readonly cursor?: string;
}

/** Five fixed role results returned by a readable destination. */
export interface EvidenceDestinationRolesResult {
  /** Intent aggregate and optional rows. */
  readonly intent: EvidenceDestinationRoleResult<"intent">;
  /** Authority aggregate and optional rows. */
  readonly authority: EvidenceDestinationRoleResult<"authority">;
  /** Change aggregate and optional rows. */
  readonly change: EvidenceDestinationRoleResult<"change">;
  /** Verification aggregate and optional rows. */
  readonly verification: EvidenceDestinationRoleResult<"verification">;
  /** Recovery aggregate and optional rows. */
  readonly recovery: EvidenceDestinationRoleResult<"recovery">;
}

/** Untrusted result returned by a readable evidence destination. */
export interface EvidenceDestinationInspectResult {
  /** Exact subject described by the result. */
  readonly subject: EvidenceSubject;
  /** Fixed five-role result map. */
  readonly roles: EvidenceDestinationRolesResult;
}

/** Optional readable capability on the canonical observability transport. */
export interface CruxEvidenceQueryDestination {
  /**
   * Read a bounded evidence view for one subject.
   *
   * @param request - Frozen, validated query captured at call entry.
   * @returns Untrusted destination data that Core validates before merging.
   */
  inspectEvidence(
    request: EvidenceDestinationInspectRequest,
  ): Promise<EvidenceDestinationInspectResult>;
}
