import type {
  CruxPrimitiveFamily,
  CruxPrimitiveName,
} from "../../observability";
import type { EvidenceRole } from "../../evidence";
import type { EvidenceKind } from "../../evidence";

/** Audited implementation status for one primitive/role pair. */
export type PrimitiveEvidenceRoleDecision =
  | "automatic"
  | "advanced-custom"
  | "blocked"
  | "native-planned"
  | "not-applicable";

/** Concrete source and test proving one automatic native role. */
export interface PrimitiveAutomaticEvidenceRole {
  /** Package-private domain callsite that authors the relationship. */
  readonly producer: string;
  /** Canonical artifact kinds that can source this automatic role. */
  readonly sourceKinds: readonly [EvidenceKind, ...EvidenceKind[]];
  readonly conformanceTest: string;
}

/** Static audit row for one canonical observability primitive. */
export interface PrimitiveEvidenceCoverageDescriptor {
  readonly name: CruxPrimitiveName;
  readonly family: CruxPrimitiveFamily;
  readonly participation: "subject" | "producer" | "consumer" | "none";
  readonly roles: Readonly<Record<EvidenceRole, PrimitiveEvidenceRoleDecision>>;
  readonly automaticRoles?: Readonly<
    Partial<Record<EvidenceRole, PrimitiveAutomaticEvidenceRole>>
  >;
  readonly blockedRoles?: Readonly<Partial<Record<EvidenceRole, string>>>;
  readonly nativeEvidence: {
    readonly status:
      | "automatic"
      | "blocked"
      | "custom-only"
      | "partial"
      | "planned";
    readonly blockers?: readonly string[];
  };
  readonly runtimeDurability: "local-durable" | "core-only" | "blocked";
  readonly otelPolicy: "closed-allowlist" | "excluded";
  readonly devtoolsRenderer: string;
  readonly conformanceTest: string;
  readonly owner: string;
  readonly interimBehavior: string;
}

export type PrimitiveEvidenceCoverageInput = Pick<
  PrimitiveEvidenceCoverageDescriptor,
  "name" | "participation"
> & {
  readonly nativeRoles?: readonly EvidenceRole[];
  readonly automaticRoles?: Readonly<
    Partial<Record<EvidenceRole, PrimitiveAutomaticEvidenceRole>>
  >;
  readonly blockedRoles?: Readonly<Partial<Record<EvidenceRole, string>>>;
  readonly notApplicableRoles?: readonly EvidenceRole[];
};
