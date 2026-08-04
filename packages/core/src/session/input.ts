import type { JsonObject, JsonValue } from "../storage";
import { SessionInputError } from "./errors";

const MAX_DEPTH = 64;
const MAX_VALUES = 100_000;
const MAX_ENCODED_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

/** Clone one parsed Session input into an immutable strict JSON value. */
export function sessionInputValue(value: unknown): JsonValue {
  try {
    return cloneJson(value, "$", 0, new WeakSet<object>(), {
      values: 0,
      bytes: 0,
    });
  } catch (cause) {
    if (cause instanceof SessionInputError) throw cause;
    throw unsafe("$");
  }
}

/** Narrow a validated Agent input to the object shape consumed by Prompt resolution. */
export function sessionInputRecord(value: JsonValue): JsonObject {
  if (isJsonObject(value)) return value;
  throw new SessionInputError(
    "Session Agent input must resolve to a JSON object.",
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: CloneState,
): JsonValue {
  if (depth > MAX_DEPTH || ++state.values > MAX_VALUES) throw unsafe(path);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    charge(state, JSON.stringify(value), path);
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      charge(state, JSON.stringify(value), path);
      return value;
    }
    throw unsafe(path);
  }
  if (typeof value !== "object") throw unsafe(path);
  if (ancestors.has(value)) throw unsafe(path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return cloneArray(value, path, depth, ancestors, state);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsafe(path);
    }
    charge(state, "{", path);
    const result: Record<string, JsonValue> = {};
    let first = true;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw unsafe(path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw unsafe(`${path}.${key}`);
      }
      if (!first) charge(state, ",", path);
      first = false;
      charge(state, `${JSON.stringify(key)}:`, `${path}.${key}`);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneJson(
          descriptor.value,
          `${path}.${key}`,
          depth + 1,
          ancestors,
          state,
        ),
        writable: true,
      });
    }
    charge(state, "}", path);
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: CloneState,
): JsonValue {
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || typeof length.value !== "number") {
    throw unsafe(path);
  }
  if (keys.length !== length.value + 1 || keys.at(-1) !== "length") {
    throw unsafe(path);
  }
  charge(state, "[", path);
  const result: JsonValue[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const key = String(index);
    if (keys[index] !== key) throw unsafe(path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw unsafe(`${path}[${index}]`);
    }
    if (index > 0) charge(state, ",", path);
    result.push(
      cloneJson(
        descriptor.value,
        `${path}[${index}]`,
        depth + 1,
        ancestors,
        state,
      ),
    );
  }
  charge(state, "]", path);
  return Object.freeze(result);
}

interface CloneState {
  values: number;
  bytes: number;
}

function charge(state: CloneState, encoded: string, path: string): void {
  state.bytes += encoder.encode(encoded).byteLength;
  if (state.bytes > MAX_ENCODED_BYTES) throw unsafe(path);
}

function unsafe(path: string): SessionInputError {
  return new SessionInputError(
    `Session input at ${path} must be a strict JSON-safe value.`,
  );
}
