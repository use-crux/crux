/** Immutable normalization for mixed inline and file-backed Case sources. */

import { getCaseFileRef, isCaseFile } from "../case-file";
import { normalizeEvalTimeoutPolicy } from "../timeout-policy";
import type {
  CaseFileRef,
  EvalCaseSourcePosition,
  RawEvalCase,
} from "./definition";
import { normalizeEvalCheck } from "./normalize-checks";

/** Normalize authored Case sources without cloning caller-owned evidence. */
export function normalizeCaseSources(value: unknown): {
  readonly cases: readonly RawEvalCase[];
  readonly caseFiles: readonly CaseFileRef[];
  readonly caseSourceOrder: readonly EvalCaseSourcePosition[];
} {
  const items = isCaseFile(value) ? [value] : value;
  if (!Array.isArray(items)) {
    throw new TypeError(
      "evaluate(): `cases` must be an array of Cases/caseFile references or one caseFile().",
    );
  }

  const cases: RawEvalCase[] = [];
  const caseFiles: CaseFileRef[] = [];
  const caseSourceOrder: EvalCaseSourcePosition[] = [];
  for (const item of items) {
    if (isCaseFile(item)) {
      caseSourceOrder.push(
        Object.freeze({ kind: "file", index: caseFiles.length }),
      );
      caseFiles.push(getCaseFileRef(item));
      continue;
    }
    assertInlineCase(item);
    const rawCase = item as Readonly<Record<string, unknown>>;
    const timeout = normalizeEvalTimeoutPolicy(
      rawCase.timeout,
      "evaluate(): Case `timeout`",
    );
    caseSourceOrder.push(
      Object.freeze({ kind: "inline", index: cases.length }),
    );
    cases.push(
      Object.freeze({
        ...rawCase,
        ...(rawCase.expect !== undefined
          ? { expect: normalizeEvalCheck(rawCase.expect, "Case `expect`") }
          : {}),
        ...(rawCase.afterScores !== undefined
          ? {
              afterScores: normalizeEvalCheck(
                rawCase.afterScores,
                "Case `afterScores`",
              ),
            }
          : {}),
        ...(timeout !== undefined ? { timeout } : {}),
        ...(item.tags !== undefined
          ? { tags: Object.freeze([...item.tags]) }
          : {}),
        ...(item.metadata !== undefined
          ? { metadata: Object.freeze({ ...item.metadata }) }
          : {}),
      }) as RawEvalCase,
    );
  }
  return {
    cases: Object.freeze(cases),
    caseFiles: Object.freeze(caseFiles),
    caseSourceOrder: Object.freeze(caseSourceOrder),
  };
}

function assertInlineCase(item: unknown): asserts item is Readonly<
  Record<string, unknown>
> & {
  readonly input: unknown;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  if (item === null || typeof item !== "object" || !("input" in item)) {
    throw new TypeError(
      "evaluate(): every inline Case must be an object with `input`.",
    );
  }
  if (
    "id" in item &&
    item.id !== undefined &&
    (typeof item.id !== "string" || item.id.trim() === "")
  ) {
    throw new TypeError(
      "evaluate(): a Case `id` must be a non-empty string when provided.",
    );
  }
  if (
    "tags" in item &&
    item.tags !== undefined &&
    (!Array.isArray(item.tags) ||
      !item.tags.every((tag: unknown) => typeof tag === "string"))
  ) {
    throw new TypeError("evaluate(): Case `tags` must be an array of strings.");
  }
  if (
    "metadata" in item &&
    item.metadata !== undefined &&
    (item.metadata === null ||
      typeof item.metadata !== "object" ||
      Array.isArray(item.metadata))
  ) {
    throw new TypeError("evaluate(): Case `metadata` must be a record.");
  }
}
