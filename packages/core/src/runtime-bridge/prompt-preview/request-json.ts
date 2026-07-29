/**
 * Canonical request encoding shared with the Local Runtime Bridge.
 *
 * The versioned format follows JCS value semantics: objects use recursive
 * UTF-16 key ordering, arrays retain authored order, and primitive rendering
 * comes from ECMAScript JSON serialization. Callers measure these UTF-8 bytes,
 * never transport whitespace or insertion order.
 *
 * @module
 */

import { utf8Bytes } from "./limits";
import { ScalarValidStringSchema } from "./protocol";

export const PROMPT_PREVIEW_REQUEST_JSON_VERSION =
  "prompt-preview-request-json-v1";

/**
 * Encode one validated complete exact-preview request.
 *
 * The walk never invokes accessors or inherited `toJSON` behavior. Invalid
 * programmatic values throw before returning partial bytes.
 */
export function canonicalPromptPreviewRequestJson(value: unknown): {
  readonly json: string;
  readonly bytes: number;
} {
  const json = encode(value, new Set<object>());
  return { json, bytes: utf8Bytes(json) };
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) invalid();
      return JSON.stringify(value);
    case "string":
      if (!ScalarValidStringSchema.safeParse(value).success) invalid();
      return JSON.stringify(value);
    case "object":
      return encodeContainer(value, ancestors);
    default:
      return invalid();
  }
}

function encodeContainer(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) invalid();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) invalid();
        values.push(encode(descriptor.value, ancestors));
      }
      const allowed = new Set<PropertyKey>([
        "length",
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(key))) {
        invalid();
      }
      return `[${values.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) invalid();
    const fields = (keys as string[]).sort().map((key) => {
      if (!ScalarValidStringSchema.safeParse(key).success) invalid();
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return invalid();
      }
      return `${JSON.stringify(key)}:${encode(descriptor.value, ancestors)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function invalid(): never {
  throw new TypeError("Value is not valid prompt-preview request JSON.");
}
