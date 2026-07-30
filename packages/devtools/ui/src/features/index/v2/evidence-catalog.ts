/**
 * Privacy-safe Catalog projections for authored and native execution evidence.
 *
 * @remarks Catalog composes compiler facts with the generated Core coverage
 * descriptor. Runtime activity is an optional annotation and never changes
 * authored coverage.
 *
 * @module
 */

import {
  PRIMITIVE_EVIDENCE_COVERAGE,
  type EvidenceRecordFacts,
  type PrimitiveEvidenceRoleDecision,
} from "@use-crux/core/project-index";
import type { EvidenceRole } from "@use-crux/core";
import type { IndexIndex, ViewDef } from "./adapt";
import { coverageForKind } from "./coverage";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[];

/** Safe diagnostic fields rendered beside one evidence authoring definition. */
export interface EvidenceAuthoringFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly message: string;
  readonly fix?: string;
}

/** Runtime correlation that is explicit about whether identity is exact. */
export type EvidenceAuthoringObservation =
  | {
      readonly kind: "exact";
      readonly definitionId: string;
      readonly runCount: number;
      readonly label: "Observed as this authoring definition";
    }
  | {
      readonly kind: "owner";
      readonly definitionId: string;
      readonly runCount: number;
      readonly label: string;
    };

/** Purpose-built Catalog view for one statically discovered `evidence.record`. */
export interface EvidenceAuthoringCatalogView {
  readonly facts: Omit<EvidenceRecordFacts, "kind">;
  readonly source?: {
    readonly file: string;
    readonly line: number;
    readonly column?: number;
  };
  readonly owner?: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
  };
  readonly findings: readonly EvidenceAuthoringFinding[];
  readonly observation?: EvidenceAuthoringObservation;
}

/**
 * Project one evidence authoring definition without exposing authored payload,
 * subject, idempotency-key, or unresolved expression values.
 */
export function projectEvidenceAuthoringCatalog(
  definition: ViewDef,
  index: IndexIndex,
  activity: Readonly<{
    exactRunCount?: number;
    ownerRunCount?: number;
  }> = {},
): EvidenceAuthoringCatalogView | undefined {
  const facts = definition.facts as EvidenceRecordFacts | undefined;
  if (
    definition.kind !== "evidence.record" ||
    facts?.kind !== "evidence.record"
  )
    return undefined;

  const owner = declaredInOwner(definition.id, index);
  const source = definition.raw.source;
  const exactRunCount = positiveCount(activity.exactRunCount);
  const ownerRunCount = positiveCount(activity.ownerRunCount);
  const observation: EvidenceAuthoringObservation | undefined =
    exactRunCount > 0
      ? {
          kind: "exact",
          definitionId: definition.id,
          runCount: exactRunCount,
          label: "Observed as this authoring definition",
        }
      : owner && ownerRunCount > 0
        ? {
            kind: "owner",
            definitionId: owner.id,
            runCount: ownerRunCount,
            label: `Observed through ${owner.name}`,
          }
        : undefined;

  return Object.freeze({
    facts: Object.freeze({
      role: facts.role,
      evidenceKind: Object.freeze({ ...facts.evidenceKind }),
      ...(facts.conclusion ? { conclusion: facts.conclusion } : {}),
      sourceForm: facts.sourceForm,
      subjectMode: facts.subjectMode,
      idempotent: facts.idempotent,
      supersedes: facts.supersedes,
    }),
    ...(source
      ? {
          source: Object.freeze({
            file: index.relPath(source.file) ?? source.file,
            line: source.line,
            ...(source.column === undefined ? {} : { column: source.column }),
          }),
        }
      : {}),
    ...(owner ? { owner: Object.freeze(owner) } : {}),
    findings: Object.freeze(
      index.lintsForDef(definition.id).map((finding) =>
        Object.freeze({
          id: finding.id,
          ruleId: finding.ruleId,
          severity: finding.severity,
          title: finding.title,
          message: finding.message,
          ...(finding.fix ? { fix: finding.fix } : {}),
        }),
      ),
    ),
    ...(observation ? { observation: Object.freeze(observation) } : {}),
  });
}

export type EvidenceCoverageStatus =
  | "automatic"
  | "caller-authored"
  | "blocked"
  | "planned"
  | "not-applicable";

export interface EvidenceCoverageEntry {
  readonly primitive: string;
  readonly status: EvidenceCoverageStatus;
  readonly sourceKinds?: readonly string[];
  readonly producer?: string;
  readonly followUp?: string;
}

export interface EvidenceCoverageCatalogView {
  readonly primitives: readonly string[];
  readonly roles: readonly {
    readonly role: EvidenceRole;
    readonly entries: readonly EvidenceCoverageEntry[];
  }[];
  readonly runtime?: {
    readonly window: string;
    readonly counts: readonly {
      readonly primitive: string;
      readonly count: number;
    }[];
  };
}

/**
 * Compose a definition kind with the exhaustive primitive evidence descriptor.
 *
 * @remarks The optional runtime window is deliberately separate from role
 * status. Observed counts cannot promote planned or caller-authored coverage.
 */
export function projectEvidenceCoverageCatalog(
  definitionKind: string,
  runtime?: Readonly<{
    window: string;
    countsByPrimitive: Readonly<Record<string, number>>;
  }>,
): EvidenceCoverageCatalogView | undefined {
  const primitives = [
    ...(coverageForKind(definitionKind).runtimePrimitiveNames ?? []),
  ];
  if (primitives.length === 0) return undefined;

  const descriptors = primitives.flatMap((primitive) => {
    const descriptor = (
      PRIMITIVE_EVIDENCE_COVERAGE as Readonly<
        Record<
          string,
          | (typeof PRIMITIVE_EVIDENCE_COVERAGE)[keyof typeof PRIMITIVE_EVIDENCE_COVERAGE]
          | undefined
        >
      >
    )[primitive];
    return descriptor ? [[primitive, descriptor] as const] : [];
  });
  if (descriptors.length === 0) return undefined;

  const roleRows = roles.map((role) =>
    Object.freeze({
      role,
      entries: Object.freeze(
        descriptors.map(([primitive, descriptor]) => {
          const automatic = descriptor.automaticRoles?.[role];
          return Object.freeze({
            primitive,
            status: catalogStatus(descriptor.roles[role]),
            ...(automatic
              ? {
                  sourceKinds: automatic.sourceKinds,
                  producer: automatic.producer,
                }
              : {}),
            ...(descriptor.blockedRoles?.[role]
              ? { followUp: descriptor.blockedRoles[role] }
              : {}),
          });
        }),
      ),
    }),
  );
  const counts = runtime
    ? descriptors.flatMap(([primitive]) => {
        const count = positiveCount(runtime.countsByPrimitive[primitive]);
        return count > 0 ? [{ primitive, count }] : [];
      })
    : [];

  return Object.freeze({
    primitives: Object.freeze(descriptors.map(([primitive]) => primitive)),
    roles: Object.freeze(roleRows),
    ...(runtime
      ? {
          runtime: Object.freeze({
            window: runtime.window,
            counts: Object.freeze(counts),
          }),
        }
      : {}),
  });
}

function declaredInOwner(
  definitionId: string,
  index: IndexIndex,
): { id: string; name: string; kind: string } | undefined {
  const relation = index
    .relationsOf(definitionId)
    .outgoing.find((item) => item.type === "evidence.record.declared_in");
  const owner = relation ? index.byId(relation.to) : undefined;
  return owner
    ? { id: owner.id, name: owner.name, kind: owner.kind }
    : undefined;
}

function catalogStatus(
  status: PrimitiveEvidenceRoleDecision,
): EvidenceCoverageStatus {
  switch (status) {
    case "advanced-custom":
      return "caller-authored";
    case "native-planned":
      return "planned";
    default:
      return status;
  }
}

function positiveCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
}
