type JsonObject = Readonly<Record<string, unknown>>;

const annotations = ["title", "description", "default"] as const;
const scalarTypes = ["string", "boolean", "number", "integer"] as const;
type ScalarType = (typeof scalarTypes)[number];

interface ScalarShape {
  readonly type: ScalarType;
  readonly nullable: boolean;
}

/**
 * Return the schema only when its complete tree fits the closed browser-form
 * subset. An unsupported child disables the whole form.
 */
export function promptPreviewFormSchema(
  schema: unknown,
): JsonObject | undefined {
  if (!isObject(schema)) return undefined;
  const state = { controls: 0 };
  return validateSchema(schema, 1, state, true) ? schema : undefined;
}

function validateSchema(
  schema: JsonObject,
  depth: number,
  state: { controls: number },
  root: boolean,
): boolean {
  if (depth > 8 || !validAnnotations(schema)) return false;
  const type = schema.type;
  if (type === "object") {
    return validateObject(schema, depth, state);
  }
  if (root) return false;
  if (type === "array") {
    return validateArray(schema, depth, state);
  }
  const scalar = scalarType(type);
  if (!scalar) return false;
  state.controls += 1;
  return state.controls <= 128 && validateScalar(schema, scalar);
}

function validateObject(
  schema: JsonObject,
  depth: number,
  state: { controls: number },
): boolean {
  if (
    !onlyKeys(schema, [
      "type",
      "properties",
      "required",
      "additionalProperties",
      ...annotations,
    ]) ||
    schema.additionalProperties !== false ||
    !isObject(schema.properties)
  ) {
    return false;
  }
  const properties = schema.properties as JsonObject;
  const propertyNames = Object.keys(properties);
  const required = schema.required ?? [];
  if (
    !Array.isArray(required) ||
    required.some((name) => typeof name !== "string") ||
    new Set(required).size !== required.length ||
    required.some((name) => !propertyNames.includes(name as string))
  ) {
    return false;
  }
  return propertyNames.every((name) => {
    const child = properties[name];
    return isObject(child) && validateSchema(child, depth + 1, state, false);
  });
}

function validateArray(
  schema: JsonObject,
  depth: number,
  state: { controls: number },
): boolean {
  if (
    !onlyKeys(schema, [
      "type",
      "items",
      "minItems",
      "maxItems",
      ...annotations,
    ]) ||
    !isObject(schema.items) ||
    !optionalNonnegativeInteger(schema.minItems) ||
    !optionalNonnegativeInteger(schema.maxItems) ||
    (typeof schema.maxItems === "number" && schema.maxItems > 100) ||
    (typeof schema.minItems === "number" &&
      typeof schema.maxItems === "number" &&
      schema.minItems > schema.maxItems)
  ) {
    return false;
  }
  state.controls += 1;
  return (
    state.controls <= 128 &&
    validateSchema(schema.items, depth + 1, state, false)
  );
}

function validateScalar(schema: JsonObject, scalar: ScalarShape): boolean {
  const type = scalar.type;
  const allowed =
    type === "string"
      ? ["type", "enum", "minLength", "maxLength", ...annotations]
      : type === "number" || type === "integer"
        ? ["type", "enum", "minimum", "maximum", ...annotations]
        : ["type", "enum", ...annotations];
  if (!onlyKeys(schema, allowed)) return false;
  if (
    !optionalNonnegativeInteger(schema.minLength) ||
    !optionalNonnegativeInteger(schema.maxLength) ||
    (typeof schema.minLength === "number" &&
      typeof schema.maxLength === "number" &&
      schema.minLength > schema.maxLength)
  ) {
    return false;
  }
  if (
    !optionalFiniteNumber(schema.minimum) ||
    !optionalFiniteNumber(schema.maximum) ||
    (typeof schema.minimum === "number" &&
      typeof schema.maximum === "number" &&
      schema.minimum > schema.maximum)
  ) {
    return false;
  }
  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length > 100 ||
      schema.enum.some((value) => !validEnumValue(value, scalar))
    ) {
      return false;
    }
  }
  return validAnnotationDefault(schema.default, scalar);
}

function scalarType(value: unknown): ScalarShape | undefined {
  if (typeof value === "string") {
    const type = scalarTypes.find((candidate) => candidate === value);
    return type ? { type, nullable: false } : undefined;
  }
  if (Array.isArray(value) && value.length === 2 && value.includes("null")) {
    const nonNull = value.find((candidate) => candidate !== "null");
    if (typeof nonNull === "string") {
      const type = scalarTypes.find((candidate) => candidate === nonNull);
      return type ? { type, nullable: true } : undefined;
    }
  }
  return undefined;
}

function validEnumValue(value: unknown, scalar: ScalarShape): boolean {
  if (value === null) return scalar.nullable;
  switch (scalar.type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
  }
}

function validAnnotationDefault(value: unknown, scalar: ScalarShape): boolean {
  return value === undefined || validEnumValue(value, scalar);
}

function validAnnotations(schema: JsonObject): boolean {
  return (
    (schema.title === undefined || typeof schema.title === "string") &&
    (schema.description === undefined || typeof schema.description === "string")
  );
}

function optionalNonnegativeInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function optionalFiniteNumber(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function onlyKeys(schema: JsonObject, allowed: readonly string[]): boolean {
  const names = new Set(allowed);
  return Object.keys(schema).every((key) => names.has(key));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
