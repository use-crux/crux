import type { ObservabilityRunDetailNode } from "@/types";
import {
  definitionRefLinks,
  type DefinitionRefLink,
} from "./definition-ref-links";

export type MemoryCaptureOperation = "turn" | "tool-event";
export type MemoryCaptureRequestedMode = "inline" | "deferred";
export type MemoryCaptureDisposition =
  | "inline"
  | "inline-fallback"
  | "retained"
  | "eval-captured";
export type MemoryCaptureOutcome = "completed" | "failed" | "captured";

/** Validated, payload-free facts rendered by the memory-capture card. */
export interface MemoryCaptureView {
  readonly memoryId: string;
  readonly operation: MemoryCaptureOperation;
  readonly requestedMode: MemoryCaptureRequestedMode;
  readonly disposition: MemoryCaptureDisposition;
  readonly sequence: number;
  readonly blockCount: number;
  readonly toolEventCount: number;
  readonly outcome?: MemoryCaptureOutcome;
  readonly code?: string;
  readonly durationMs: number;
  readonly status: string;
  readonly memory?: DefinitionRefLink;
}

const operations = ["turn", "tool-event"] as const;
const requestedModes = ["inline", "deferred"] as const;
const dispositions = [
  "inline",
  "inline-fallback",
  "retained",
  "eval-captured",
] as const;
const outcomes = ["completed", "failed", "captured"] as const;

function isMember<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function dispositionMatchesMode(
  mode: MemoryCaptureRequestedMode,
  disposition: MemoryCaptureDisposition,
): boolean {
  return mode === "inline"
    ? disposition === "inline"
    : disposition !== "inline";
}

function outcomeMatchesDisposition(
  disposition: MemoryCaptureDisposition,
  outcome: MemoryCaptureOutcome | undefined,
): boolean {
  if (outcome === undefined) return true;
  return disposition === "eval-captured"
    ? outcome === "captured"
    : outcome !== "captured";
}

function memoryLink(
  node: ObservabilityRunDetailNode,
  knownDefinitionIds: ReadonlySet<string> | undefined,
): DefinitionRefLink | undefined {
  return definitionRefLinks(
    node.definitionRefs ?? [],
    knownDefinitionIds,
  ).find((link) => link.kind === "memory" && link.role === "invoked-memory");
}

/**
 * Project a canonical `memory.capture` node into closed, presentation-safe data.
 *
 * Unknown enum values and malformed attribute types return `undefined`. The
 * projection intentionally never reads the span's raw error field.
 */
export function memoryCaptureFromNode(
  node: ObservabilityRunDetailNode,
  knownDefinitionIds?: ReadonlySet<string>,
): MemoryCaptureView | undefined {
  if (node.primitive !== "memory.capture") return undefined;

  const attributes = node.attributes;
  if (!attributes) return undefined;

  const memoryId = attributes.memoryId;
  const operation = attributes.operation;
  const requestedMode = attributes.requestedMode;
  const disposition = attributes.disposition;
  const sequence = attributes.sequence;
  const blockCount = attributes.blockCount;
  const toolEventCount = attributes.toolEventCount;
  const outcome = attributes.outcome;
  const code = attributes.code;

  if (
    !nonEmptyString(memoryId) ||
    !isMember(operations, operation) ||
    !isMember(requestedModes, requestedMode) ||
    !isMember(dispositions, disposition) ||
    !nonNegativeInteger(sequence) ||
    sequence === 0 ||
    !nonNegativeInteger(blockCount) ||
    !nonNegativeInteger(toolEventCount) ||
    (outcome !== undefined && !isMember(outcomes, outcome)) ||
    (code !== undefined &&
      (!nonEmptyString(code) || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code))) ||
    !dispositionMatchesMode(requestedMode, disposition) ||
    !outcomeMatchesDisposition(disposition, outcome)
  ) {
    return undefined;
  }

  return {
    memoryId,
    operation,
    requestedMode,
    disposition,
    sequence,
    blockCount,
    toolEventCount,
    outcome,
    code,
    durationMs: node.durationMs,
    status: node.status,
    memory: memoryLink(node, knownDefinitionIds),
  };
}
