/**
 * Canonical Local execution-evidence HTTP contract consumed by Devtools.
 *
 * @remarks Local preserves run/span wire discrimination while Core's public
 * authoring API uses a provider-neutral execution reference. Keep this type at
 * the destination boundary instead of casting the response to authoring types.
 *
 * @module
 */

import type {
  EvidenceConclusion,
  EvidenceExplicitCoverageStatus,
  EvidencePayloadState,
  EvidencePayloadUnavailableReason,
  EvidenceRole,
  EvidenceRoleStatus,
} from "@use-crux/core/evidence";

export type EvidenceApiSubject =
  | { readonly kind: "execution"; readonly id: string }
  | { readonly kind: "artifact"; readonly id: string }
  | {
      readonly kind: "effect.receipt";
      readonly id: string;
      readonly effectId: string;
    };

export interface EvidenceApiRef<R extends EvidenceRole = EvidenceRole> {
  readonly kind: "execution.evidence";
  readonly id: string;
  readonly subject: EvidenceApiSubject;
  readonly role: R;
  readonly evidenceKind: string;
  readonly recordedAt: string;
}

export interface EvidenceApiRecord<R extends EvidenceRole = EvidenceRole> {
  readonly ref: EvidenceApiRef<R>;
  readonly source: EvidenceApiSubject;
  readonly conclusion?: EvidenceConclusion<R>;
  readonly observedAt?: string;
  readonly supersedes: readonly EvidenceApiRef<R>[];
  readonly producer?:
    { readonly kind: "execution"; readonly id: string };
  readonly acceptedAfterTerminal?: {
    readonly judgedAgainst:
      | { readonly kind: "run"; readonly id: string }
      | { readonly kind: "span"; readonly id: string };
  };
  readonly payloadState: EvidencePayloadState;
  readonly payloadUnavailableReason?: EvidencePayloadUnavailableReason;
  readonly data?: unknown;
}

export interface EvidenceApiRoleResult<R extends EvidenceRole> {
  readonly role: R;
  readonly status: EvidenceRoleStatus;
  /** Exact complete active relationship count before pagination. */
  readonly activeRecordCount: number;
  readonly records: readonly EvidenceApiRecord<R>[];
  readonly history?: readonly EvidenceApiRecord<R>[];
  readonly coverage?: EvidenceExplicitCoverageStatus;
  readonly conclusion?: EvidenceConclusion<R>;
  readonly conflicting: boolean;
  readonly truncated: boolean;
  readonly cursor?: string;
}

/** Five-role response whose role keys and generic role values cannot drift. */
export type EvidenceApiRoles = {
  readonly [R in EvidenceRole]: EvidenceApiRoleResult<R>;
};

export interface EvidenceApiInspectRequest {
  readonly subject: EvidenceApiSubject;
  readonly role?: EvidenceRole;
  readonly limit: number;
  readonly cursor?: string;
  readonly includeHistory: boolean;
  readonly includeData: boolean;
}

export interface EvidenceApiInspectResult {
  readonly subject: EvidenceApiSubject;
  readonly roles: EvidenceApiRoles;
}

/** Canonical qualified graph reference accepted by Local navigation. */
export type EvidenceApiGraphRef =
  | { readonly kind: "run"; readonly id: string }
  | { readonly kind: "span"; readonly id: string }
  | { readonly kind: "artifact"; readonly id: string }
  | { readonly kind: "effect.receipt"; readonly id: string };

export type EvidenceApiSubjectSummaryResult =
  | {
      readonly subject: EvidenceApiSubject;
      readonly status: "available";
      readonly totalActiveRecordCount: number;
    }
  | {
      readonly subject: EvidenceApiSubject;
      readonly status: "unavailable";
    };

export interface EvidenceApiSubjectSummaryResponse {
  readonly results: readonly EvidenceApiSubjectSummaryResult[];
}

export interface EvidenceApiNavigationOwner {
  readonly kind: "run" | "span";
  readonly runId: string;
  readonly spanId?: string;
  readonly retainedDefinitionRefs: readonly EvidenceApiDefinitionRef[];
}

export interface EvidenceApiDefinitionRef {
  readonly id: string;
  readonly kind: string;
  readonly role: string;
  readonly source?: {
    readonly file: string;
    readonly line: number;
    readonly column?: number;
  };
}

export type EvidenceApiNavigationTarget =
  | {
      readonly kind: "run";
      readonly runId: string;
      readonly traceId: string;
      readonly retainedDefinitionRefs: readonly EvidenceApiDefinitionRef[];
    }
  | {
      readonly kind: "span";
      readonly spanId: string;
      readonly runId: string;
      readonly traceId: string;
      readonly retainedDefinitionRefs: readonly EvidenceApiDefinitionRef[];
    }
  | {
      readonly kind: "artifact";
      readonly artifactId: string;
      readonly runId: string;
      readonly traceId: string;
      readonly owner: EvidenceApiNavigationOwner;
    };

export type EvidenceApiNavigationResult =
  | {
      readonly ref: EvidenceApiGraphRef;
      readonly status: "resolved";
      readonly target: EvidenceApiNavigationTarget;
    }
  | {
      readonly ref: EvidenceApiGraphRef;
      readonly status: "unavailable";
      readonly reason: "retained-out" | "deleted" | "unresolved";
    };

export interface EvidenceApiNavigationResponse {
  readonly results: readonly EvidenceApiNavigationResult[];
}
