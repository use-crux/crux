import type { ContextTextSegment } from "../prompt/context-types";
import type { PromptText } from "./index";
import { createTemplateNode, renderPromptTextNode } from "./render";

export interface LiteralPart {
  readonly kind: "literal";
  readonly text: string;
}

export interface InterpolationPart {
  readonly kind: "interpolation";
  readonly index: number;
  readonly position: "block" | "inline";
  readonly value: SnapshotValue;
}

export interface TemplateLine {
  readonly parts: readonly (LiteralPart | InterpolationPart)[];
}

export interface TemplateNode {
  readonly kind: "template";
  readonly lines: readonly TemplateLine[];
}

export interface JsonNode {
  readonly kind: "json";
  readonly text: string;
}

export type SnapshotValue =
  | { readonly kind: "scalar"; readonly text: string }
  | { readonly kind: "fragment"; readonly value: PromptText }
  | { readonly kind: "omitted" }
  | { readonly kind: "sequence"; readonly items: readonly SnapshotValue[] };

export type PromptTextNode = TemplateNode | JsonNode;

export type PromptTextErrorCode =
  | "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION"
  | "CRUX_PROMPT_TEXT_INLINE_SEQUENCE"
  | "CRUX_PROMPT_TEXT_JSON_SERIALIZATION";

const promptTextErrors = new WeakSet<object>();
const promptTextErrorOwners = new WeakMap<object, Set<string>>();

/** @internal Stable authored-text failure retained across resolver context. */
export class PromptTextError extends TypeError {
  readonly name = "PromptTextError";

  constructor(
    readonly code: PromptTextErrorCode,
    message: string,
    readonly interpolationIndex?: number,
    readonly interpolationPath: readonly number[] = [],
  ) {
    super(`${code}: ${message}`);
    promptTextErrors.add(this);
  }
}

/**
 * @internal Append resolver ownership without replacing the stable error.
 *
 * Returning the original instance preserves all structural fields and any
 * native `cause` attached by the runtime.
 */
export function contextualizePromptTextError(
  error: unknown,
  owner: string,
): unknown {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return error;
  }
  if (!promptTextErrors.has(error)) return error;
  const promptTextError = error as PromptTextError;
  const owners =
    promptTextErrorOwners.get(promptTextError) ?? new Set<string>();
  if (owners.has(owner)) return promptTextError;
  owners.add(owner);
  promptTextErrorOwners.set(promptTextError, owners);
  promptTextError.message = `${promptTextError.message} ${owner}`;
  return promptTextError;
}

export interface RenderedPromptText {
  readonly text: string;
  readonly segments: readonly ContextTextSegment[];
}

const promptTextNodes = new WeakMap<object, PromptTextNode>();

function registerPromptText(node: PromptTextNode): PromptText {
  const shell = Object.freeze(Object.create(null)) as object;
  promptTextNodes.set(shell, node);
  return shell as PromptText;
}

export function createPromptText(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): PromptText {
  const snapshots = values.map((value, index) =>
    snapshotValue(value, {
      index,
      path: [],
      stack: new Set(),
    }),
  );
  const node = createTemplateNode(strings, snapshots);
  for (const line of node.lines) {
    for (const part of line.parts) {
      if (
        part.kind === "interpolation" &&
        part.position === "inline" &&
        part.value.kind === "sequence"
      ) {
        const remedy =
          "move the sequence to a line by itself or join scalar values with native `.join()`";
        throw new PromptTextError(
          "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
          `Inline sequence at interpolation ${part.index}; ${remedy}.`,
          part.index,
        );
      }
    }
  }
  return registerPromptText(node);
}

export function createJsonPromptText(value: unknown): PromptText {
  let text: string | undefined;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    throw jsonSerializationError();
  }
  if (typeof text !== "string") {
    throw jsonSerializationError();
  }
  return registerPromptText(Object.freeze({ kind: "json", text }));
}

/** @internal Recognize only PromptText shells created by this core instance. */
export function isPromptText(value: unknown): value is PromptText {
  return (
    typeof value === "object" && value !== null && promptTextNodes.has(value)
  );
}

/** @internal Lower an opaque PromptText tree to exact text and provenance. */
export function lowerPromptText(value: PromptText): RenderedPromptText {
  const node = promptTextNodes.get(value as object);
  if (!node) throw new TypeError("Expected a PromptText value.");
  return renderPromptTextNode(node, getPromptTextNode);
}

function getPromptTextNode(value: PromptText): PromptTextNode {
  const node = promptTextNodes.get(value as object);
  if (!node) throw new TypeError("Expected a PromptText value.");
  return node;
}

interface SnapshotLocation {
  readonly index: number;
  readonly path: readonly number[];
  readonly stack: Set<readonly unknown[]>;
}

function snapshotValue(
  value: unknown,
  location: SnapshotLocation,
): SnapshotValue {
  if (isPromptText(value)) {
    return Object.freeze({ kind: "fragment", value });
  }
  if (isArrayValue(value)) {
    return snapshotSequence(value, location);
  }
  if (typeof value === "string") {
    return Object.freeze({ kind: "scalar", text: value });
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze({ kind: "scalar", text: String(value) });
  }
  if (value === false || value === null || value === undefined) {
    return Object.freeze({ kind: "omitted" });
  }
  throw invalidInterpolation(location, invalidKind(value));
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function snapshotSequence(
  values: readonly unknown[],
  location: SnapshotLocation,
): SnapshotValue {
  if (location.stack.has(values)) {
    throw invalidInterpolation(location, "cyclic array");
  }
  location.stack.add(values);
  const items = Array.from({ length: values.length }, (_, index) =>
    snapshotValue(values[index], {
      ...location,
      path: [...location.path, index],
    }),
  );
  location.stack.delete(values);
  return Object.freeze({
    kind: "sequence",
    items: Object.freeze(items),
  });
}

function invalidInterpolation(
  location: SnapshotLocation,
  kind: string,
): PromptTextError {
  const remedy =
    "select a scalar field, return a fragment, or use md.json() for intentional JSON";
  return new PromptTextError(
    "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
    `Invalid ${kind} at ${formatInterpolation(location)}; ${remedy}.`,
    location.index,
    Object.freeze([...location.path]),
  );
}

function jsonSerializationError(): PromptTextError {
  const remedy =
    "remove cycles/bigint or serialize explicitly before interpolation";
  return new PromptTextError(
    "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
    `md.json() could not produce JSON text; ${remedy}.`,
  );
}

function formatInterpolation(
  location: Pick<SnapshotLocation, "index" | "path">,
): string {
  return `interpolation ${location.index}${location.path.map((part) => `[${part}]`).join("")}`;
}

function invalidKind(value: unknown): string {
  if (typeof value === "number") return "non-finite number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  return "object";
}
