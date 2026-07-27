import type { EvalTimeoutPolicyProjection } from "@use-crux/core/project-index";
import type { EvalCatalogEntry } from "../types";

const scalarKeys = [
  "totalMs",
  "stepMs",
  "chunkMs",
  "firstToken",
  "toolMs",
] as const;
const policyKeys = new Set<string>([...scalarKeys, "tools"]);
const projectionKeys = new Set(["authored", "effective"]);

function malformed(path: string): never {
  throw new TypeError(`malformed Eval catalog at ${path}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalBudget(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value > 0)
  );
}

function parseTools(
  value: unknown,
  path: string,
): Readonly<Record<string, number | null>> {
  if (!isRecord(value)) malformed(path);
  const entries = Object.entries(value).map(([key, budget]) => {
    if (!isCanonicalBudget(budget)) malformed(`${path}.${key}`);
    return [key, budget] as const;
  });
  const keys = entries.map(([key]) => key);
  const sorted = [...keys].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (!keys.every((key, index) => key === sorted[index])) malformed(path);
  return Object.freeze(Object.fromEntries(entries));
}

function parsePolicy(
  value: unknown,
  path: string,
): EvalTimeoutPolicyProjection["effective"] {
  if (!isRecord(value)) malformed(path);
  if (!Object.keys(value).every((key) => policyKeys.has(key))) malformed(path);

  const scalars = Object.fromEntries(
    scalarKeys.flatMap((key) => {
      if (!Object.hasOwn(value, key)) return [];
      const budget = value[key];
      if (!isCanonicalBudget(budget)) malformed(`${path}.${key}`);
      return [[key, budget] as const];
    }),
  );
  const tools = Object.hasOwn(value, "tools")
    ? parseTools(value.tools, `${path}.tools`)
    : undefined;
  return Object.freeze({
    ...scalars,
    ...(tools === undefined ? {} : { tools }),
  });
}

function parseProjection(
  value: unknown,
  path: string,
): EvalTimeoutPolicyProjection {
  if (!isRecord(value)) malformed(path);
  if (!Object.keys(value).every((key) => projectionKeys.has(key))) {
    malformed(path);
  }
  if (!Object.hasOwn(value, "effective")) malformed(`${path}.effective`);

  const authored = Object.hasOwn(value, "authored")
    ? value.authored === null
      ? null
      : parsePolicy(value.authored, `${path}.authored`)
    : undefined;
  const effective = parsePolicy(value.effective, `${path}.effective`);
  return Object.freeze({
    ...(authored === undefined ? {} : { authored }),
    effective,
  });
}

function parseCase(
  value: unknown,
  path: string,
): EvalCatalogEntry["cases"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") {
    malformed(path);
  }
  if (
    value.unvalidatedExpected !== undefined &&
    value.unvalidatedExpected !== true
  ) {
    malformed(`${path}.unvalidatedExpected`);
  }
  const timeout = Object.hasOwn(value, "timeout")
    ? parseProjection(value.timeout, `${path}.timeout`)
    : undefined;
  return Object.freeze({
    id: value.id,
    ...(value.unvalidatedExpected === true
      ? { unvalidatedExpected: true as const }
      : {}),
    ...(timeout === undefined ? {} : { timeout }),
  });
}

function parseEntry(value: unknown, path: string): EvalCatalogEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id === "" ||
    typeof value.definitionFingerprint !== "string" ||
    !isRecord(value.sourceKey) ||
    typeof value.sourceKey.relativeFile !== "string" ||
    !Array.isArray(value.cases) ||
    !Array.isArray(value.variants) ||
    !value.variants.every((variant) => typeof variant === "string")
  ) {
    malformed(path);
  }
  const timeout = Object.hasOwn(value, "timeout")
    ? parseProjection(value.timeout, `${path}.timeout`)
    : undefined;
  return Object.freeze({
    ...value,
    sourceKey: Object.freeze({ relativeFile: value.sourceKey.relativeFile }),
    cases: Object.freeze(
      value.cases.map((item, index) =>
        parseCase(item, `${path}.cases[${index}]`),
      ),
    ),
    variants: Object.freeze([...value.variants]),
    ...(timeout === undefined ? {} : { timeout }),
  }) as EvalCatalogEntry;
}

/**
 * Validate the Eval catalog boundary while accepting legacy timeout omission.
 *
 * @param value - Untrusted JSON returned by the Local catalog endpoint.
 * @returns An immutable catalog with exact canonical timeout projections.
 */
export function parseEvalCatalog(value: unknown): readonly EvalCatalogEntry[] {
  if (!Array.isArray(value)) malformed("root");
  return Object.freeze(
    value.map((entry, index) => parseEntry(entry, `entries[${index}]`)),
  );
}
