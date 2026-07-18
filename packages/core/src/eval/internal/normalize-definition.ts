/**
 * Runtime validation and immutable normalization for inert Eval definitions.
 *
 * This module owns Crux-created shells only. Tasks, schemas, scorers,
 * callbacks, Case inputs, and expected evidence retain their authored
 * identities.
 *
 * @internal
 * @module
 */

import { getCaseFileRef, isCaseFile } from "../case-file";
import type { EvalCoverageTargetId } from "../evaluate";
import type {
  CaseFileRef,
  EvalArmDeclaration,
  EvalCaseSourcePosition,
  EvalDefinitionV1,
  RawEvalCase,
} from "./definition";
import { normalizeEvalCheck, normalizeEvalGates } from "./normalize-checks";

interface RawEvaluateOptions {
  readonly id?: unknown;
  readonly task?: unknown;
  readonly cases?: unknown;
  readonly variants?: unknown;
  readonly expect?: unknown;
  readonly afterScores?: unknown;
  readonly scorers?: unknown;
  readonly gates?: unknown;
  readonly trials?: unknown;
  readonly tags?: unknown;
  readonly description?: unknown;
  readonly covers?: unknown;
}

/** Normalized Eval identity and the private definition stored on its wrapper. */
export interface NormalizedEvalDefinition {
  readonly id: string | undefined;
  readonly definition: EvalDefinitionV1;
}

function normalizeCaseSources(value: unknown): {
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
      throw new TypeError(
        "evaluate(): Case `tags` must be an array of strings.",
      );
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
    const rawCase = item as Readonly<Record<string, unknown>>;
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
        ...("tags" in item && item.tags !== undefined
          ? { tags: Object.freeze([...item.tags]) }
          : {}),
        ...("metadata" in item && item.metadata !== undefined
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

function normalizeStringArray(
  value: unknown,
  option: "tags" | "covers",
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new TypeError(
      `evaluate(): \`${option}\` must be an array of strings.`,
    );
  }
  return Object.freeze([...value]);
}

function normalizeVariants(value: unknown): {
  readonly variants: EvalDefinitionV1["variants"];
  readonly arms: readonly EvalArmDeclaration[];
} {
  if (value === undefined) {
    return {
      variants: Object.freeze({}),
      arms: Object.freeze([
        Object.freeze({ name: "current", overrideKeys: Object.freeze([]) }),
      ]),
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "evaluate(): `variants` must be a record of override objects.",
    );
  }

  const variants = Object.create(null) as Record<
    string,
    Readonly<Record<string, unknown>>
  >;
  const arms: EvalArmDeclaration[] = [
    Object.freeze({ name: "current", overrideKeys: Object.freeze([]) }),
  ];
  for (const [name, overrides] of Object.entries(value)) {
    if (name === "current" || name === "baseline") {
      throw new TypeError(`evaluate(): Variant name '${name}' is reserved.`);
    }
    if (
      overrides === null ||
      typeof overrides !== "object" ||
      Array.isArray(overrides)
    ) {
      throw new TypeError(
        `evaluate(): Variant '${name}' must be an override object.`,
      );
    }
    const normalized = Object.freeze({ ...overrides });
    variants[name] = normalized;
    arms.push(
      Object.freeze({
        name,
        overrideKeys: Object.freeze(Object.keys(normalized)),
      }),
    );
  }
  return {
    variants: Object.freeze(variants),
    arms: Object.freeze(arms),
  };
}

function normalizeScorers(value: unknown): unknown {
  if (value === undefined) return Object.freeze([]);
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

/** Validate authoring options and create the private immutable manifest. */
export function normalizeEvalDefinition(
  options: unknown,
): NormalizedEvalDefinition {
  if (options === null || typeof options !== "object") {
    throw new TypeError("evaluate(): expected an options object.");
  }
  assertTopLevelKeys(options as Readonly<Record<string, unknown>>);
  const raw = options as RawEvaluateOptions;
  if (raw.task === undefined)
    throw new TypeError("evaluate(): `task` is required.");
  if (raw.cases === undefined)
    throw new TypeError("evaluate(): `cases` is required.");

  const explicitId = raw.id;
  if (
    explicitId !== undefined &&
    (typeof explicitId !== "string" || explicitId.trim() === "")
  ) {
    throw new TypeError(
      "evaluate(): `id` must be a non-empty string when provided.",
    );
  }

  const { variants, arms } = normalizeVariants(raw.variants);
  const { cases, caseFiles, caseSourceOrder } = normalizeCaseSources(raw.cases);
  const gates = normalizeEvalGates(raw.gates);
  return {
    id: explicitId,
    definition: Object.freeze({
      schemaVersion: 1,
      ...(explicitId !== undefined ? { explicitId } : {}),
      task: raw.task,
      cases,
      caseFiles,
      caseSourceOrder,
      variants,
      arms,
      ...(raw.expect !== undefined
        ? { expect: normalizeEvalCheck(raw.expect, "`expect`") }
        : {}),
      ...(raw.afterScores !== undefined
        ? {
            afterScores: normalizeEvalCheck(raw.afterScores, "`afterScores`"),
          }
        : {}),
      scorers: normalizeScorers(raw.scorers),
      ...(gates !== undefined ? { gates } : {}),
      trials: (raw.trials as number | undefined) ?? 1,
      tags: normalizeStringArray(raw.tags, "tags"),
      ...(raw.description !== undefined
        ? { description: raw.description as string }
        : {}),
      covers: normalizeStringArray(
        raw.covers,
        "covers",
      ) as readonly EvalCoverageTargetId[],
    }),
  };
}

const EVAL_OPTION_KEYS = new Set([
  "id",
  "task",
  "cases",
  "variants",
  "expect",
  "afterScores",
  "scorers",
  "gates",
  "trials",
  "tags",
  "description",
  "covers",
]);

function assertTopLevelKeys(options: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(options)) {
    if (EVAL_OPTION_KEYS.has(key)) continue;
    const legacy = legacyOptionRemedy(key);
    throw new TypeError(
      legacy ?? `evaluate(): unknown top-level option \`${key}\`. Check the Eval API spelling.`,
    );
  }
}

function legacyOptionRemedy(key: string): string | undefined {
  switch (key) {
    case "dataset":
      return "evaluate(): `dataset` was removed. Use `cases` for inline values or caseFile() for external rows.";
    case "baseline":
      return "evaluate(): `baseline` was removed. Set a complete run as the Baseline through the CLI or Devtools.";
    case "suite":
      return "evaluate(): `suite` was removed. Export one Eval per evaluate() definition and select Evals with the CLI.";
    case "target":
      return "evaluate(): `target` was removed. Pass the production callable as `task`.";
    case "cassette":
    case "cassettes":
    case "cache":
      return `evaluate(): \`${key}\` was removed. Exact safe evidence reuse is automatic; use --fresh to bypass it.`;
    default:
      return undefined;
  }
}
