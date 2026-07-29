/**
 * Bounded JSON validation shared by exact-preview programmatic and wire paths.
 *
 * Validation walks own property descriptors without invoking accessors. It
 * accepts only JSON-native prototypes and computes the contract's deterministic
 * depth, node, key, string, and decoded-weight measurements.
 *
 * @module
 */

import {
  PROMPT_PREVIEW_MAX_DEPTH,
  PROMPT_PREVIEW_MAX_KEYS,
  PROMPT_PREVIEW_MAX_KEY_BYTES,
  PROMPT_PREVIEW_MAX_NODES,
  PROMPT_PREVIEW_MAX_REQUEST_BYTES,
  PROMPT_PREVIEW_MAX_STRING_BYTES,
  PROMPT_PREVIEW_MAX_VALUE_WEIGHT,
  utf8Bytes,
} from "./limits";
import { ScalarValidStringSchema } from "./protocol";
import { canonicalPromptPreviewRequestJson } from "./request-json";

export class PromptPreviewRequestValidationError extends Error {
  override readonly name = "PromptPreviewRequestValidationError";

  constructor(readonly kind: "invalid" | "limit") {
    super(
      kind === "limit"
        ? "Exact-preview input exceeds a limit."
        : "Exact-preview input is invalid.",
    );
  }
}

/** Validate request size and input structure without transforming input. */
export function validatePromptPreviewRequest(request: {
  readonly payload: { readonly input: unknown };
}): void {
  validateJsonObject(request.payload.input);
  let bytes: number;
  try {
    bytes = canonicalPromptPreviewRequestJson(request).bytes;
  } catch {
    throw new PromptPreviewRequestValidationError("invalid");
  }
  if (bytes > PROMPT_PREVIEW_MAX_REQUEST_BYTES) {
    throw new PromptPreviewRequestValidationError("limit");
  }
}

/** Reject duplicate keys in raw JSON before `JSON.parse()` discards evidence. */
export function assertNoDuplicateJsonKeys(text: string): void {
  const scanner = new JsonDuplicateScanner(text);
  scanner.scan();
}

function validateJsonObject(value: unknown): void {
  const seen = new Set<object>();
  const counters = { nodes: 0, keys: 0 };
  visit(value, 1, seen, counters);
  if (!isPlainObject(value)) {
    throw new PromptPreviewRequestValidationError("invalid");
  }
}

function visit(
  value: unknown,
  depth: number,
  seen: Set<object>,
  counters: { nodes: number; keys: number },
): number {
  counters.nodes += 1;
  if (counters.nodes > PROMPT_PREVIEW_MAX_NODES) limit();

  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return 8;
  }
  if (typeof value === "string") {
    if (!ScalarValidStringSchema.safeParse(value).success) invalid();
    const bytes = utf8Bytes(value);
    if (bytes > PROMPT_PREVIEW_MAX_STRING_BYTES) limit();
    return bytes;
  }
  if (typeof value !== "object") invalid();
  if (depth > PROMPT_PREVIEW_MAX_DEPTH) limit();
  if (seen.has(value)) invalid();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) invalid();
      }
      const unexpected = Reflect.ownKeys(descriptors).filter(
        (key) =>
          key !== "length" &&
          !(
            typeof key === "string" &&
            /^(0|[1-9]\d*)$/u.test(key) &&
            Number(key) < value.length
          ),
      );
      if (unexpected.length > 0) invalid();
      let weight = 2 + Math.max(0, value.length - 1);
      for (let index = 0; index < value.length; index += 1) {
        const child = descriptors[String(index)]!.value;
        weight += visit(child, childDepth(depth, child), seen, counters);
        if (weight > PROMPT_PREVIEW_MAX_VALUE_WEIGHT) limit();
      }
      return weight;
    }
    if (!isPlainObject(value)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) invalid();
    counters.keys += keys.length;
    if (counters.keys > PROMPT_PREVIEW_MAX_KEYS) limit();
    let weight = 2 + Math.max(0, keys.length - 1);
    for (const key of keys as string[]) {
      if (!ScalarValidStringSchema.safeParse(key).success) invalid();
      const keyBytes = utf8Bytes(key);
      if (keyBytes > PROMPT_PREVIEW_MAX_KEY_BYTES) limit();
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable) invalid();
      weight +=
        keyBytes +
        1 +
        visit(
          descriptor.value,
          childDepth(depth, descriptor.value),
          seen,
          counters,
        );
      if (weight > PROMPT_PREVIEW_MAX_VALUE_WEIGHT) limit();
    }
    return weight;
  } finally {
    seen.delete(value);
  }
}

function childDepth(depth: number, value: unknown): number {
  return typeof value === "object" && value !== null ? depth + 1 : depth;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(): never {
  throw new PromptPreviewRequestValidationError("invalid");
}

function limit(): never {
  throw new PromptPreviewRequestValidationError("limit");
}

class JsonDuplicateScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scan(): void {
    this.skipWhitespace();
    this.value();
    this.skipWhitespace();
    if (this.index !== this.text.length) invalid();
  }

  private value(): void {
    this.skipWhitespace();
    switch (this.text[this.index]) {
      case "{":
        this.object();
        return;
      case "[":
        this.array();
        return;
      case '"':
        this.string();
        return;
      default:
        this.primitive();
    }
  }

  private object(): void {
    this.index += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.consume("}")) return;
    for (;;) {
      const key = this.string();
      if (keys.has(key)) invalid();
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.value();
      this.skipWhitespace();
      if (this.consume("}")) return;
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private array(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    for (;;) {
      this.value();
      this.skipWhitespace();
      if (this.consume("]")) return;
      this.expect(",");
    }
  }

  private string(): string {
    const start = this.index;
    this.expect('"');
    let escaped = false;
    while (this.index < this.text.length) {
      const character = this.text[this.index++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
    }
    invalid();
  }

  private primitive(): void {
    while (
      this.index < this.text.length &&
      !/[\s,\]}]/u.test(this.text[this.index]!)
    ) {
      this.index += 1;
    }
  }

  private skipWhitespace(): void {
    while (/[\t\n\r ]/u.test(this.text[this.index] ?? "")) this.index += 1;
  }

  private expect(character: string): void {
    if (!this.consume(character)) invalid();
  }

  private consume(character: string): boolean {
    if (this.text[this.index] !== character) return false;
    this.index += 1;
    return true;
  }
}
