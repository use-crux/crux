/**
 * Closed supported vocabulary for caller-authored raw JSON Schemas.
 *
 * Unlike a Zod-derived canonical schema (whose shape the converter controls), a
 * raw tool input schema can use any draft-07 keyword and any structural shape the
 * AI SDK's `JSONSchema7` type accepts. Lowering only traverses a fixed set of
 * schema-bearing positions and only descends into `properties`/`items` when an
 * explicit matching `type` is present, so a schema that omits that `type`, uses a
 * multi-type `type` array, or expresses null through `enum`/`const` could bypass
 * strict lowering or nested capability checks. This preflight closes the subset
 * both by keyword name and by schema semantics: before any provider request it
 * rejects every keyword, applicator, and structural shape lowering does not
 * itself soundly handle.
 *
 * @module
 */

import { CruxUnsupportedSchemaError } from "./errors";
import type { JsonSchemaObject } from "./plan";

type PathSegment = string | number | "*";

/**
 * Keywords lowering understands. Structural keywords (`properties`, `items`,
 * `anyOf`, `oneOf`, boolean `additionalProperties`) are traversed by lowering;
 * the rest are leaf/annotation keywords with no schema children. Any keyword not
 * listed is rejected, so newly encountered applicators fail closed. The
 * noncanonical `nullable` keyword is intentionally absent: null is expressed only
 * through `type`, `enum`, `const`, or a union null branch.
 */
const SUPPORTED_RAW_KEYWORDS: ReadonlySet<string> = new Set([
  // Structural (schema-bearing) positions lowering traverses.
  "properties",
  "items",
  "anyOf",
  "oneOf",
  "additionalProperties",
  // Leaf / annotation keywords with no schema children.
  "type",
  "enum",
  "const",
  "required",
  "title",
  "description",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
  "$schema",
  "$id",
  "$comment",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/**
 * Assert a raw JSON Schema uses only the closed supported vocabulary and only
 * structural shapes lowering soundly handles, recursing into every schema-bearing
 * position lowering will later traverse.
 *
 * @throws {CruxUnsupportedSchemaError} For any unsupported keyword; a
 *   schema-valued `additionalProperties`; a tuple/boolean `items`; `properties`
 *   without `type: "object"` or `items` without `type: "array"`; a multi-type
 *   `type` array; or a malformed accepted-keyword value.
 */
export function assertSupportedRawVocabulary(
  node: unknown,
  capabilitiesId: string,
  path: readonly PathSegment[] = [],
): void {
  const reject = (reason: string): never => {
    throw new CruxUnsupportedSchemaError(capabilitiesId, reason, path);
  };

  // A boolean schema is a valid JSON Schema; `supportsBooleanSchemas` is enforced
  // by lowering, so it is not rejected here.
  if (typeof node === "boolean") return;
  const record = asRecord(node);
  if (!record) {
    reject("a schema value must be an object or boolean in a raw tool input schema");
    return;
  }

  for (const keyword of Object.keys(record)) {
    if (!SUPPORTED_RAW_KEYWORDS.has(keyword)) {
      reject(
        `the "${keyword}" keyword is not supported in a raw tool input schema`,
      );
    }
  }

  if ("type" in record) assertSupportedType(record.type, reject);
  if ("enum" in record && !Array.isArray(record.enum)) {
    reject("`enum` must be an array in a raw tool input schema");
  }

  // Object-only keywords require an explicit `type: "object"`; array-only `items`
  // requires `type: "array"`. Lowering only normalizes these positions under the
  // matching explicit type, so any mismatch would bypass capability lowering.
  const isObjectType = record.type === "object";
  const isArrayType = record.type === "array";

  if ("required" in record) {
    if (!isObjectType) {
      reject('`required` requires `type: "object"` in a raw tool input schema');
    }
    assertRequired(record.required, reject);
  }

  // `additionalProperties` is supported only as a boolean; a schema-valued form
  // is a schema-bearing position lowering does not traverse.
  if ("additionalProperties" in record) {
    if (!isObjectType) {
      reject(
        '`additionalProperties` requires `type: "object"` in a raw tool input schema',
      );
    }
    if (typeof record.additionalProperties !== "boolean") {
      reject(
        "a schema-valued `additionalProperties` is not supported in a raw tool input schema",
      );
    }
  }

  if ("properties" in record) {
    if (!isObjectType) {
      reject('`properties` requires `type: "object"` in a raw tool input schema');
    }
    const properties = asRecord(record.properties);
    if (!properties) {
      reject("`properties` must be an object in a raw tool input schema");
      return;
    }
    for (const [key, child] of Object.entries(properties)) {
      assertSupportedRawVocabulary(child, capabilitiesId, [...path, key]);
    }
  }

  // `items` is only traversed as a single schema object; tuple and boolean forms
  // are not traversed by lowering.
  if ("items" in record) {
    if (!isArrayType) {
      reject('`items` requires `type: "array"` in a raw tool input schema');
    }
    if (Array.isArray(record.items)) {
      reject("tuple `items` are not supported in a raw tool input schema");
    }
    if (typeof record.items === "boolean") {
      reject("a boolean `items` is not supported in a raw tool input schema");
    }
    if (!asRecord(record.items)) {
      reject("`items` must be a schema object in a raw tool input schema");
      return;
    }
    assertSupportedRawVocabulary(record.items, capabilitiesId, [...path, "*"]);
  }

  for (const keyword of ["anyOf", "oneOf"] as const) {
    if (keyword in record) {
      const branches = record[keyword];
      if (!Array.isArray(branches)) {
        reject(`\`${keyword}\` must be an array in a raw tool input schema`);
        return;
      }
      if (branches.length === 0) {
        reject(`\`${keyword}\` must not be empty in a raw tool input schema`);
      }
      branches.forEach((branch, index) =>
        assertSupportedRawVocabulary(branch, capabilitiesId, [
          ...path,
          keyword,
          index,
        ]),
      );
    }
  }
}

/** The draft-07 primitive type names a raw tool schema may name. */
const KNOWN_TYPE_NAMES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/**
 * Reject a `type` that is not a known type-name string or a canonical
 * single-type array (optionally with `null`). Unknown names, empty or duplicate
 * arrays, and multi-type arrays (a union outside the `supportsUnions` capability)
 * all fail closed.
 */
function assertSupportedType(
  type: unknown,
  reject: (reason: string) => never,
): void {
  if (typeof type === "string") {
    if (!KNOWN_TYPE_NAMES.has(type)) {
      reject(`unknown \`type\` "${type}" in a raw tool input schema`);
    }
    return;
  }
  if (!Array.isArray(type)) {
    reject("`type` must be a type-name string or array in a raw tool input schema");
    return;
  }
  if (type.length === 0) {
    reject("`type` array must not be empty in a raw tool input schema");
  }
  const seen = new Set<unknown>();
  for (const entry of type) {
    if (typeof entry !== "string" || !KNOWN_TYPE_NAMES.has(entry)) {
      reject("`type` array must contain only known type-name strings");
    }
    if (seen.has(entry)) {
      reject("`type` array must not contain duplicates in a raw tool input schema");
    }
    seen.add(entry);
  }
  const nonNull = type.filter((entry) => entry !== "null");
  if (nonNull.length > 1) {
    reject("a multi-type `type` array is not supported in a raw tool input schema");
  }
}

/** Reject a `required` that is not an array of property-name strings. */
function assertRequired(
  required: unknown,
  reject: (reason: string) => never,
): void {
  if (!Array.isArray(required) || required.some((k) => typeof k !== "string")) {
    reject("`required` must be an array of property names in a raw tool input schema");
  }
}

function asRecord(value: unknown): JsonSchemaObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : undefined;
}
