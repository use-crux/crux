/**
 * Pure Catalog projections for authored Safety architecture.
 *
 * The Project Index is allowed to expose authored policy configuration, but
 * this projection accepts only JSON-safe strategy facts and definition
 * descriptors. Runtime media, locators, and provider values never enter it.
 *
 * @module
 */

export type SafetyCatalogTarget = Readonly<{
  id: string;
  name: string;
  kind: string;
}>;

export type SafetyCatalogStrategy = Readonly<{
  kind: string;
  action?: string;
  config?: Readonly<Record<string, unknown>>;
}>;

/** Purpose-built Catalog view for one authored guardrail or constraint. */
export type SafetyPolicyCatalogView = Readonly<{
  kind: "guardrail" | "constraint";
  id: string;
  name: string;
  boundaries: readonly string[];
  strategy?: SafetyCatalogStrategy;
  targets: readonly SafetyCatalogTarget[];
}>;

/** Purpose-built Catalog view for Safety attached to one media operation. */
export type OperationSafetyCatalogView = Readonly<{
  kind: "media.operation";
  id: string;
  name: string;
  policies: readonly SafetyPolicyCatalogView[];
  hasSafetyOptions: boolean;
}>;

/**
 * Project an indexed Safety definition into the fields Catalog can explain.
 *
 * Boundary order is preserved because tuple order is part of the authored
 * policy contract. Callers should pass already-resolved operation targets;
 * unresolved relation ids remain visible through the generic Relations panel.
 */
export function projectSafetyPolicyCatalog(
  input: Readonly<{
    id: string;
    name: string;
    kind: string;
    facts?: unknown;
    targets?: readonly SafetyCatalogTarget[];
  }>,
): SafetyPolicyCatalogView | undefined {
  if (input.kind !== "guardrail" && input.kind !== "constraint") {
    return undefined;
  }

  const facts = asRecord(input.facts);
  const primaryBoundary = stringValue(facts?.boundary);
  const boundaries = uniqueStrings([
    ...stringList(facts?.boundaries),
    ...(primaryBoundary ? [primaryBoundary] : []),
  ]);
  const strategy = projectStrategy(facts?.strategy);

  return Object.freeze({
    kind: input.kind,
    id: input.id,
    name: input.name,
    boundaries: Object.freeze(boundaries),
    ...(strategy ? { strategy } : {}),
    targets: Object.freeze([...(input.targets ?? [])]),
  });
}

/** Project the resolved Safety attachments of one completed media operation. */
export function projectOperationSafetyCatalog(
  input: Readonly<{
    id: string;
    name: string;
    kind: string;
    policies?: readonly SafetyPolicyCatalogView[];
    hasSafetyOptions?: boolean;
  }>,
): OperationSafetyCatalogView | undefined {
  if (input.kind !== "media.operation") return undefined;
  return Object.freeze({
    kind: "media.operation",
    id: input.id,
    name: input.name,
    policies: Object.freeze([...(input.policies ?? [])]),
    hasSafetyOptions: input.hasSafetyOptions === true,
  });
}

function projectStrategy(value: unknown): SafetyCatalogStrategy | undefined {
  const strategy = asRecord(value);
  const kind = stringValue(strategy?.kind);
  if (!kind) return undefined;

  const config = jsonRecord(strategy?.config);
  const action = stringValue(config?.action);
  return Object.freeze({
    kind,
    ...(action ? { action } : {}),
    ...(config ? { config: Object.freeze(config) } : {}),
  });
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).flatMap(([key, nested]) => {
    const projected = jsonValue(nested);
    return projected === undefined ? [] : [[key, projected] as const];
  });
  return Object.fromEntries(entries);
}

function jsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.flatMap((item) => {
        const projected = jsonValue(item);
        return projected === undefined ? [] : [projected];
      }),
    );
  }
  const record = jsonRecord(value);
  return record ? Object.freeze(record) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
