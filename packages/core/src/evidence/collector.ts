import {
  createScopeFacetSlot,
  currentScope,
} from "../scope/internal";
import {
  EVIDENCE_ROLES,
  type EvidenceKind,
  type EvidenceRole,
} from "./roles";
import type {
  CruxEvidenceId,
  EvidenceRecord,
  EvidenceRef,
} from "./record-types";
import {
  evidenceSubjectKey,
  type EvidenceSourceRef,
  type EvidenceSubject,
} from "./subjects";
import type { EvidenceCoverageFact } from "./coverage";

const MAX_RECORDS_PER_ROLE = 50;

interface EvidenceCollectorSnapshot {
  readonly records: Readonly<Record<EvidenceRole, readonly EvidenceRecord[]>>;
  readonly coverage: Readonly<
    Record<EvidenceRole, readonly EvidenceCoverageFact[]>
  >;
  readonly truncated: Readonly<Record<EvidenceRole, boolean>>;
  readonly version: number;
}

interface EvidenceCollector {
  append(record: EvidenceRecord, contentFingerprint?: string): void;
  appendCoverageFact(fact: EvidenceCoverageFact): boolean;
  createsSupersessionCycle(
    candidateId: CruxEvidenceId,
    supersedes: readonly EvidenceRef[],
  ): boolean;
  kindForSource(source: EvidenceSourceRef): EvidenceKind | undefined;
  idempotentOccurrence(
    evidenceId: CruxEvidenceId,
  ):
    | {
        readonly ref: EvidenceRef;
        readonly contentFingerprint: string;
      }
    | undefined;
  snapshot(subject: EvidenceSubject): EvidenceCollectorSnapshot | undefined;
}

const evidenceCollectorFacet =
  createScopeFacetSlot<EvidenceCollector>("core.evidence");

/** Return the active root collector, creating it for a write when requested. */
export function activeEvidenceCollector(
  create: boolean,
): EvidenceCollector | undefined {
  const scope = currentScope();
  if (!scope) return undefined;
  const root = scope.root;
  const existing = root.facet(evidenceCollectorFacet);
  if (existing || !create) return existing;

  const collector = createEvidenceCollector();
  root.setFacet(evidenceCollectorFacet, collector);
  return collector;
}

function createEvidenceCollector(): EvidenceCollector {
  const sourceKinds = new Map<string, EvidenceKind>();
  const sourceKindReferences = new Map<string, number>();
  const byEvidenceId = new Map<CruxEvidenceId, EvidenceRecord>();
  const idempotencyFingerprints = new Map<CruxEvidenceId, string>();
  const bySubject = new Map<
    string,
    {
      readonly records: Record<EvidenceRole, EvidenceRecord[]>;
      readonly coverage: Record<EvidenceRole, EvidenceCoverageFact[]>;
      readonly truncated: Record<EvidenceRole, boolean>;
      version: number;
    }
  >();

  return {
    append(record, contentFingerprint) {
      if (
        record.payloadState === "available" &&
        record.source.kind === "artifact"
      ) {
        const sourceKey = evidenceSubjectKey(record.source);
        sourceKinds.set(sourceKey, record.ref.evidenceKind);
        sourceKindReferences.set(
          sourceKey,
          (sourceKindReferences.get(sourceKey) ?? 0) + 1,
        );
      }
      byEvidenceId.set(record.ref.id, record);
      if (contentFingerprint !== undefined) {
        idempotencyFingerprints.set(record.ref.id, contentFingerprint);
      }
      const key = evidenceSubjectKey(record.ref.subject);
      let entry = bySubject.get(key);
      if (!entry) {
        entry = {
          records: roleRecord(),
          coverage: roleCoverage(),
          truncated: roleFlags(),
          version: 0,
        };
        bySubject.set(key, entry);
      }
      const records = entry.records[record.ref.role];
      records.push(record);
      entry.version += 1;
      if (records.length > MAX_RECORDS_PER_ROLE) {
        const evicted = records.shift();
        if (evicted) removeIndexes(evicted);
        entry.truncated[record.ref.role] = true;
      }
    },
    appendCoverageFact(fact) {
      const key = evidenceSubjectKey(fact.subject);
      let entry = bySubject.get(key);
      if (!entry) {
        entry = {
          records: roleRecord(),
          coverage: roleCoverage(),
          truncated: roleFlags(),
          version: 0,
        };
        bySubject.set(key, entry);
      }
      const facts = entry.coverage[fact.role];
      const conflicting =
        facts.length > 0 &&
        !facts.some(({ status }) => status === fact.status);
      if (!facts.some(({ status }) => status === fact.status)) {
        facts.push(fact);
        entry.version += 1;
      }
      return conflicting;
    },
    createsSupersessionCycle(candidateId, supersedes) {
      const pending = supersedes.map((ref) => ref.id);
      const visited = new Set<CruxEvidenceId>();
      while (pending.length > 0) {
        const id = pending.pop();
        if (!id) continue;
        if (id === candidateId) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        const record = byEvidenceId.get(id);
        if (record) {
          pending.push(...record.supersedes.map((ref) => ref.id));
        }
      }
      return false;
    },
    kindForSource(source) {
      return sourceKinds.get(evidenceSubjectKey(source));
    },
    idempotentOccurrence(evidenceId) {
      const record = byEvidenceId.get(evidenceId);
      const contentFingerprint = idempotencyFingerprints.get(evidenceId);
      if (!record || contentFingerprint === undefined) return undefined;
      return {
        ref: record.ref,
        contentFingerprint,
      };
    },
    snapshot(subject) {
      const entry = bySubject.get(evidenceSubjectKey(subject));
      if (!entry) return undefined;
      return Object.freeze({
        records: Object.freeze(
          Object.fromEntries(
            EVIDENCE_ROLES.map((role) => [
              role,
              Object.freeze([...entry.records[role]]),
            ]),
          ) as Record<EvidenceRole, readonly EvidenceRecord[]>,
        ),
        coverage: Object.freeze(
          Object.fromEntries(
            EVIDENCE_ROLES.map((role) => [
              role,
              Object.freeze([...entry.coverage[role]]),
            ]),
          ) as Record<EvidenceRole, readonly EvidenceCoverageFact[]>,
        ),
        truncated: Object.freeze({ ...entry.truncated }),
        version: entry.version,
      });
    },
  };

  function removeIndexes(record: EvidenceRecord): void {
    if (byEvidenceId.get(record.ref.id) === record) {
      byEvidenceId.delete(record.ref.id);
      idempotencyFingerprints.delete(record.ref.id);
    }
    if (
      record.payloadState !== "available" ||
      record.source.kind !== "artifact"
    ) {
      return;
    }
    const sourceKey = evidenceSubjectKey(record.source);
    const references = (sourceKindReferences.get(sourceKey) ?? 1) - 1;
    if (references > 0) {
      sourceKindReferences.set(sourceKey, references);
      return;
    }
    sourceKindReferences.delete(sourceKey);
    sourceKinds.delete(sourceKey);
  }
}

function roleCoverage(): Record<EvidenceRole, EvidenceCoverageFact[]> {
  return {
    intent: [],
    authority: [],
    change: [],
    verification: [],
    recovery: [],
  };
}

function roleRecord(): Record<EvidenceRole, EvidenceRecord[]> {
  return {
    intent: [],
    authority: [],
    change: [],
    verification: [],
    recovery: [],
  };
}

function roleFlags(): Record<EvidenceRole, boolean> {
  return {
    intent: false,
    authority: false,
    change: false,
    verification: false,
    recovery: false,
  };
}
