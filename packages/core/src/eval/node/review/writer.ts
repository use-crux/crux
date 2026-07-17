import { canonicalJson } from "../../internal/evidence/canonical-json";
import { getEvalTaskSchemasForInternalUse } from "../../internal/runner";
import { hydrateEvalCases } from "../cases";
import { normalizeCaseRow } from "../case-rows";
import { discoverProjectEvals, selectEvals } from "../discovery";
import { canonicalCaseSemantics, canonicalReviewRow } from "./canonical";
import { atomicAppend, resolveReviewSidecar } from "./filesystem";
import type { AddReviewCaseInput, AddReviewCaseResult } from "./types";

/** Validate and atomically add human-reviewed evidence to an Eval sidecar. */
export async function addReviewCase(
  input: AddReviewCaseInput,
): Promise<AddReviewCaseResult> {
  if (input.saveCorrection === true && input.correctionProposal === undefined) {
    throw new TypeError(
      "saveCorrection requires an explicit correctionProposal",
    );
  }
  const discovered = await discoverOne(input.projectRoot, input.evalId);
  const hydrated = await hydrateEvalCases(discovered, {
    projectRoot: input.projectRoot,
  });
  const row = {
    schemaVersion: 1 as const,
    id: input.id,
    input: input.input,
    ...(input.call !== undefined ? { call: input.call } : {}),
    ...(input.saveCorrection === true
      ? { expected: input.correctionProposal }
      : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    metadata: {
      source: "review" as const,
      reviewId: input.reviewId,
      runId: input.runId,
      addedAt: (input.now ?? (() => new Date()))().toISOString(),
    },
  };
  const schemas = getEvalTaskSchemasForInternalUse(discovered.eval);
  if (schemas.inputSchema === undefined) {
    throw new TypeError("Add-to-eval requires a managed task input schema");
  }
  const normalized = await normalizeCaseRow({
    value: row,
    displayPath: discovered.sidecarFile,
    kind: "sidecar",
    inputSchema: schemas.inputSchema,
  });
  const persistedRow = {
    schemaVersion: 1 as const,
    id: normalized.id,
    input: normalized.authored.input,
    ...(normalized.authored.call !== undefined
      ? { call: normalized.authored.call }
      : {}),
    ...(normalized.authored.expected !== undefined
      ? { expected: normalized.authored.expected }
      : {}),
    ...(normalized.authored.name !== undefined
      ? { name: normalized.authored.name }
      : {}),
    ...(normalized.authored.tags !== undefined
      ? { tags: normalized.authored.tags }
      : {}),
    metadata: row.metadata,
  };
  const canonicalRow = canonicalReviewRow(persistedRow);
  const artifact = {
    path: discovered.sidecarFile,
    row: canonicalRow,
    unvalidatedExpected: normalized.unvalidatedExpected,
  };
  const semantics = canonicalCaseSemantics(normalized);
  const linked = hydrated.cases.find(
    (entry) => canonicalCaseSemantics(entry) === semantics,
  );
  if (linked !== undefined) {
    return Object.freeze({ status: "linked", caseId: linked.id, ...artifact });
  }
  const conflict = hydrated.cases.find((entry) => entry.id === normalized.id);
  if (conflict !== undefined) {
    return Object.freeze({
      status: "conflict",
      caseId: normalized.id,
      existing: canonicalJson(conflict.authored),
      ...artifact,
    });
  }
  if (input.repositoryWritable === false) {
    return Object.freeze({
      status: "pending-sync",
      caseId: normalized.id,
      ...artifact,
    });
  }
  const path = await resolveReviewSidecar(
    input.projectRoot,
    discovered.sidecarFile,
  );
  await atomicAppend(path, canonicalRow);
  const verified = await hydrateEvalCases(discovered, {
    projectRoot: input.projectRoot,
  });
  const matches = verified.cases.filter(
    (entry) =>
      entry.id === normalized.id && canonicalCaseSemantics(entry) === semantics,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Add-to-eval verification failed for Case '${normalized.id}' in '${discovered.sidecarFile}'`,
    );
  }
  return Object.freeze({ status: "added", caseId: normalized.id, ...artifact });
}

async function discoverOne(projectRoot: string, evalId: string) {
  const discovery = await discoverProjectEvals(projectRoot);
  if (discovery.errors.length > 0) {
    throw new TypeError(
      discovery.errors.map((entry) => entry.message).join("\n"),
    );
  }
  const selected = selectEvals(discovery.evals, [evalId]);
  if (selected.errors.length > 0 || selected.matches.length !== 1) {
    throw new TypeError(
      selected.errors.join("\n") || `Eval '${evalId}' is ambiguous`,
    );
  }
  return selected.matches[0]!;
}
