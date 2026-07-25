/**
 * Capability-driven schema lowering.
 *
 * Walks the canonical JSON Schema in deterministic document order and applies the
 * closed set of provider lowering rules required by a capability profile:
 *
 * - drop JSON Schema keywords the provider rejects (`unsupportedKeywords`);
 * - normalize `additionalProperties` (`must-be-false` / `unsupported` / left);
 * - under `requiresAllProperties`, rewrite each authored optional-only property
 *   to required + nullable and record a reversible `delete-null-sentinel`
 *   operation for that occurrence.
 *
 * Genuine nullable and nullish properties keep their null and gain no operation.
 *
 * @module
 */

import type { StructuredOutputCapabilities } from "./capabilities";
import type { StructuredOutputDiagnostic } from "./diagnostics";
import type { JsonSchemaObject, StructuredOutputDecodeOperation } from "./plan";
import { CruxUnsupportedSchemaError } from "./errors";
import { schemaHasReference } from "./references";
import { assertSupportedRawVocabulary } from "./raw-schema-vocabulary";

type PathSegment = string | number | "*";

/** The decode manifest's array-wildcard segment; a property with this name is ambiguous. */
const WILDCARD = "*";

/** The result of lowering one canonical schema for one capability profile. */
export interface LoweringResult {
  readonly outputSchema: JsonSchemaObject;
  readonly operations: readonly StructuredOutputDecodeOperation[];
  readonly diagnostics: readonly StructuredOutputDiagnostic[];
  /** Stable identifiers of applied lowering decisions, in document order. */
  readonly decisions: readonly string[];
}

interface LoweringContext {
  readonly capabilities: StructuredOutputCapabilities;
  readonly unsupported: ReadonlySet<string>;
  readonly operations: StructuredOutputDecodeOperation[];
  readonly diagnostics: StructuredOutputDiagnostic[];
  readonly decisions: string[];
  /**
   * Whether the source is a caller-authored raw JSON Schema. Raw schemas are
   * lowered against a closed supported vocabulary: any structural keyword the
   * kernel cannot soundly represent is rejected before transport, rather than
   * silently carried to the provider or bypassing capability checks.
   */
  readonly rawSchema: boolean;
}

/**
 * Lower a canonical schema for a capability profile.
 *
 * @throws {CruxUnsupportedSchemaError} For recursion the profile does not
 *   support, an unsupported union, an optional occurrence inside a recursive
 *   schema that cannot be reversibly encoded, or (for raw schemas) a structural
 *   keyword outside the closed supported vocabulary.
 */
export function lowerForCapabilities(
  canonical: JsonSchemaObject,
  capabilities: StructuredOutputCapabilities,
  options?: { readonly rawSchema?: boolean },
): LoweringResult {
  // Raw schemas are checked against the closed supported vocabulary up front, so
  // every keyword and schema-bearing position is either traversed by lowering or
  // rejected before transport.
  if (options?.rawSchema) {
    assertSupportedRawVocabulary(canonical, capabilities.id);
  }

  const hasReference = schemaHasReference(canonical);
  // Zod inlines every reused non-recursive schema, so a `$ref` in the canonical
  // document is always a recursion cycle. A profile that rejects references
  // therefore also rejects recursion; both are enforced up front.
  if (hasReference && !capabilities.supportsReferences) {
    throw new CruxUnsupportedSchemaError(
      capabilities.id,
      "schema references are not supported",
    );
  }
  if (hasReference && !capabilities.supportsRecursiveSchemas) {
    throw new CruxUnsupportedSchemaError(
      capabilities.id,
      "recursive schemas are not supported",
    );
  }

  const context: LoweringContext = {
    capabilities,
    unsupported: new Set(capabilities.unsupportedKeywords),
    operations: [],
    diagnostics: [],
    decisions: [],
    rawSchema: options?.rawSchema ?? false,
  };
  const outputSchema = lowerNode(canonical, [], context) as JsonSchemaObject;

  if (hasReference && context.operations.length > 0) {
    throw new CruxUnsupportedSchemaError(
      capabilities.id,
      "an optional property inside a recursive schema cannot be reversibly encoded",
    );
  }

  return {
    outputSchema,
    operations: context.operations,
    diagnostics: context.diagnostics,
    decisions: context.decisions,
  };
}

function lowerNode(
  node: unknown,
  path: readonly PathSegment[],
  context: LoweringContext,
): unknown {
  // A boolean schema (`true`/`false` in a schema position) is rarely emitted by
  // the canonical Zod conversion, but is rejected up front when the profile
  // cannot represent it so the field stays truthful.
  if (typeof node === "boolean") {
    if (!context.capabilities.supportsBooleanSchemas) {
      throw new CruxUnsupportedSchemaError(
        context.capabilities.id,
        "boolean schemas are not supported",
        path,
      );
    }
    return node;
  }
  const record = asRecord(node);
  if (!record) return node;
  // A canonical (Zod) `$ref` is a recursion cycle carried through untouched; a
  // raw `$ref` is already rejected by the closed-vocabulary preflight.
  if (typeof record.$ref === "string") return node;

  // A genuine authored nullable (`z.nullable`/`z.nullish`) reaches here before
  // any optional-to-nullable lowering, which itself requires supportsNullable.
  if (!context.capabilities.supportsNullable && acceptsNull(record)) {
    throw new CruxUnsupportedSchemaError(
      context.capabilities.id,
      "nullable schemas are not supported",
      path,
    );
  }

  let result = dropUnsupportedKeywords(record, path, context);
  result = lowerUnion(result, "anyOf", path, context);
  result = lowerUnion(result, "oneOf", path, context);

  // Every explicit object schema is lowered — even one without `properties` —
  // so `additionalProperties` normalization always runs for the profile.
  if (result.type === "object") {
    result = lowerObject(result, path, context);
  } else if (result.type === "array" && asRecord(result.items)) {
    result = { ...result, items: lowerNode(result.items, [...path, "*"], context) };
  }

  return result;
}

/**
 * Lower a union keyword (`anyOf`/`oneOf`), rejecting a real multi-branch union
 * the profile cannot represent and lowering each branch in place.
 *
 * The decode manifest is a flat, branch-unaware path list: an operation recorded
 * while lowering one branch would be applied unconditionally at decode time and
 * could reject a valid value that selected a different branch. So, as with
 * recursive schemas, a branch whose lowering emits any decode operation cannot be
 * reversibly encoded and is rejected before transport.
 */
function lowerUnion(
  result: JsonSchemaObject,
  keyword: "anyOf" | "oneOf",
  path: readonly PathSegment[],
  context: LoweringContext,
): JsonSchemaObject {
  const branches = result[keyword];
  if (!Array.isArray(branches)) return result;
  // Only branches that represent *only* null are discounted; a mixed branch such
  // as `{ enum: [null, "x"] }` still counts as a real union branch.
  const realBranches = branches.filter((branch) => !isNullOnlyBranch(branch));
  if (realBranches.length > 1 && !context.capabilities.supportsUnions) {
    throw new CruxUnsupportedSchemaError(
      context.capabilities.id,
      "unions are not supported",
      path,
    );
  }
  const operationsBefore = context.operations.length;
  const lowered = {
    ...result,
    [keyword]: branches.map((branch) => lowerNode(branch, path, context)),
  };
  if (context.operations.length > operationsBefore) {
    throw new CruxUnsupportedSchemaError(
      context.capabilities.id,
      "an optional property inside a union branch cannot be reversibly encoded",
      path,
    );
  }
  return lowered;
}

function lowerObject(
  node: JsonSchemaObject,
  path: readonly PathSegment[],
  context: LoweringContext,
): JsonSchemaObject {
  const result: JsonSchemaObject = { ...node };
  const properties = asRecord(node.properties);

  // A valid object schema may omit `properties` entirely; only lower them when
  // present. `additionalProperties` normalization below runs either way.
  if (properties) {
    const requiredKeys = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );
    const requiresAll = context.capabilities.requiresAllProperties;
    const keys = Object.keys(properties);
    const loweredProperties: Record<string, unknown> = {};

    for (const key of keys) {
      const childPath: PathSegment[] = [...path, key];
      const rawChild = properties[key];
      const optionalOnly =
        requiresAll && !requiredKeys.has(key) && !acceptsNull(rawChild);

      // Record the ancestor operation before descending so ancestor operations
      // precede descendant operations in document order.
      if (optionalOnly) {
        if (key === WILDCARD) {
          throw new CruxUnsupportedSchemaError(
            context.capabilities.id,
            `an optional property named "${WILDCARD}" collides with the decode manifest's array wildcard`,
            childPath,
          );
        }
        if (hasUnwalkedComposite(rawChild)) {
          throw new CruxUnsupportedSchemaError(
            context.capabilities.id,
            "an optional property whose schema contains allOf/prefixItems cannot be reversibly encoded",
            childPath,
          );
        }
        context.operations.push({
          kind: "delete-null-sentinel",
          path: childPath,
        });
        context.diagnostics.push({
          code: "lowered-optional-to-nullable",
          message: "optional property lowered to required + nullable",
          path: childPath,
        });
        context.decisions.push(`optional-null:${childPath.join(".")}`);
      }

      let loweredChild = lowerNode(rawChild, childPath, context);
      if (optionalOnly) loweredChild = makeNullable(loweredChild);
      loweredProperties[key] = loweredChild;
    }

    result.properties = loweredProperties;
    if (requiresAll) result.required = keys;
  }

  applyAdditionalProperties(result, context);
  return result;
}

/** Normalize `additionalProperties` on an object per the profile's capability. */
function applyAdditionalProperties(
  node: JsonSchemaObject,
  context: LoweringContext,
): void {
  switch (context.capabilities.additionalProperties) {
    case "must-be-false":
      node.additionalProperties = false;
      break;
    case "unsupported":
      delete node.additionalProperties;
      break;
    case "supported":
      break;
  }
}

/** Return a shallow copy of a node without any provider-rejected keywords. */
function dropUnsupportedKeywords(
  record: JsonSchemaObject,
  path: readonly PathSegment[],
  context: LoweringContext,
): JsonSchemaObject {
  if (context.unsupported.size === 0) return { ...record };
  const result: JsonSchemaObject = {};
  for (const [key, value] of Object.entries(record)) {
    if (context.unsupported.has(key)) {
      context.diagnostics.push({
        code: "dropped-unsupported-keyword",
        message: `dropped unsupported keyword "${key}"`,
        path,
      });
      context.decisions.push(`drop-keyword:${path.join(".")}:${key}`);
      continue;
    }
    result[key] = value;
  }
  return result;
}

/** Add a `null` option to a schema unless it already accepts null. */
function makeNullable(node: unknown): unknown {
  if (acceptsNull(node)) return node;
  const record = asRecord(node);
  if (record && Array.isArray(record.anyOf)) {
    return { ...record, anyOf: [...record.anyOf, { type: "null" }] };
  }
  if (record && Array.isArray(record.oneOf)) {
    return { ...record, oneOf: [...record.oneOf, { type: "null" }] };
  }
  return { anyOf: [node, { type: "null" }] };
}

/**
 * Whether a schema accepts `null`, recursively — through `type`, a type array,
 * `const`, `enum`, or any `anyOf`/`oneOf` branch. Used for optional-sentinel
 * decisions, {@link makeNullable}, and the `supportsNullable` check, so a genuine
 * (possibly composed) null is never mistaken for an optional transport sentinel.
 */
function acceptsNull(node: unknown): boolean {
  if (typeof node === "boolean") return node;
  const record = asRecord(node);
  if (!record) return false;
  if (record.type === "null") return true;
  if (Array.isArray(record.type) && record.type.includes("null")) return true;
  if (Array.isArray(record.enum) && record.enum.includes(null)) return true;
  if ("const" in record && record.const === null) return true;
  if (Array.isArray(record.anyOf) && record.anyOf.some(acceptsNull)) return true;
  // `allOf` is a conjunction: the value is null-accepting only when EVERY branch is.
  if (Array.isArray(record.allOf) && record.allOf.every(acceptsNull)) return true;
  return Array.isArray(record.oneOf) && record.oneOf.some(acceptsNull);
}

/**
 * Whether this node contains a composite the lowering walker does not traverse.
 *
 * The optional-to-nullable encoding is only reversible if we can see every place a
 * `null` could legitimately come from. `allOf` and tuple `prefixItems` are not walked,
 * so recording a delete-null-sentinel under one could silently delete an authored
 * `null` (or leave an optional property inside a tuple unlowered for a provider that
 * requires all properties). Fail closed instead — over-reject, never silently corrupt.
 */
function hasUnwalkedComposite(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) return false;
  if (Array.isArray(record.allOf) || Array.isArray(record.prefixItems)) return true;
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = record[key];
    if (Array.isArray(branches) && branches.some(hasUnwalkedComposite)) return true;
  }
  return false;
}

/**
 * Whether a union branch represents *only* null — `{ type: "null" }`,
 * `{ const: null }`, `{ enum: [null] }`, a null-only type array, or a union all
 * of whose branches are null-only. Used only to decide whether a union still has
 * multiple real non-null branches; a mixed branch that merely accepts null (e.g.
 * `{ enum: [null, "x"] }`) is not null-only.
 */
function isNullOnlyBranch(node: unknown): boolean {
  const record = asRecord(node);
  if (!record) return false;
  if (record.type === "null") return true;
  if (
    Array.isArray(record.type) &&
    record.type.length > 0 &&
    record.type.every((entry) => entry === "null")
  ) {
    return true;
  }
  if ("const" in record && record.const === null) return true;
  if (
    Array.isArray(record.enum) &&
    record.enum.length > 0 &&
    record.enum.every((value) => value === null)
  ) {
    return true;
  }
  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    return record.anyOf.every(isNullOnlyBranch);
  }
  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) {
    return record.oneOf.every(isNullOnlyBranch);
  }
  return false;
}

function asRecord(value: unknown): JsonSchemaObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : undefined;
}
