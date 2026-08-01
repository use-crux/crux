/**
 * Privacy-safe presentation projection for `effect.run` spans.
 *
 * The card reads only canonical `crux.effect.*` attributes and the allowlisted
 * receipt summary. Missing or malformed telemetry stays absent instead of
 * making Run Detail fail.
 */

import type { ObservabilityRunDetailNode } from "@/types";

export type EffectOutcome =
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type EffectRecoveryState =
  | "recoverable"
  | "unavailable"
  | "irreversible"
  | "recovered"
  | "recovery-failed"
  | "ambiguous";

export interface EffectResourceSummary {
  readonly type: string;
  readonly id?: string;
  readonly namespace?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface EffectRunPresentation {
  readonly effectId: string;
  readonly effectVersion: number;
  readonly receiptId: string;
  readonly outcome: EffectOutcome;
  readonly recoveryState: EffectRecoveryState;
  readonly resource?:
    | EffectResourceSummary
    | readonly EffectResourceSummary[];
  readonly recoveryOfSpanId?: string;
}

export interface EffectRunRollup {
  readonly effects: number;
  readonly recoverable: number;
  readonly ambiguous: number;
  readonly label: string;
}

const TERMINAL_EFFECT_OUTCOMES = [
  "succeeded", "failed", "cancelled", "unknown",
] as const;
const EFFECT_OUTCOMES = [
  "preparing", "running", ...TERMINAL_EFFECT_OUTCOMES,
] as const;
const EFFECT_RECOVERIES = [
  "available", "unavailable", "irreversible", "expired", "conflict",
  "handler_unavailable", "ambiguous", "recovered",
] as const;

/** Project one canonical Effect span into the closed run-card contract. */
export function projectEffectRun(
  node: ObservabilityRunDetailNode,
  root?: ObservabilityRunDetailNode,
): EffectRunPresentation | undefined {
  if (node.primitive !== "effect.run") return undefined;
  const attributes = recordValue(node.attributes);
  const receipt = effectReceipt(node);
  const effectId = stringValue(receipt?.effectId) ??
    stringValue(attributes?.["crux.effect.id"]);
  const effectVersion = positiveInteger(receipt?.effectVersion) ??
    positiveInteger(attributes?.["crux.effect.version"]);
  const receiptId = stringValue(receipt?.receiptId) ??
    stringValue(attributes?.["crux.effect.receipt.id"]);
  const outcome = enumValue(receipt?.outcome, TERMINAL_EFFECT_OUTCOMES) ??
    enumValue(attributes?.["crux.effect.outcome"], EFFECT_OUTCOMES);
  const recovery = enumValue(receipt?.recovery, EFFECT_RECOVERIES) ??
    enumValue(attributes?.["crux.effect.recovery"], EFFECT_RECOVERIES);
  if (!effectId || !effectVersion || !receiptId || !outcome || !recovery) {
    return undefined;
  }
  const resource = resourceSummary(receipt?.resource);
  const recoveryOfSpanId = recoveryTarget(node);
  const linkedAttempt = recoveryOfSpanId
    ? undefined
    : linkedRecoveryAttempt(node, root);
  return {
    effectId,
    effectVersion,
    receiptId,
    outcome,
    recoveryState:
      recoveryOfSpanId && outcome !== "preparing" && outcome !== "running"
      ? recoveryAttemptState(outcome)
      : linkedAttempt?.recoveryState ?? recoveryState(recovery),
    ...(recoveryOfSpanId ? { recoveryOfSpanId } : {}),
    ...(resource ? { resource } : {}),
  };
}

/** Summarize original Effect executions for the existing run stat strip. */
export function effectRollup(
  root: ObservabilityRunDetailNode | undefined,
): EffectRunRollup {
  let effects = 0;
  let recoverable = 0;
  let ambiguous = 0;
  if (root) {
    visitNodes(root, (node) => {
      const effect = projectEffectRun(node, root);
      if (!effect || effect.recoveryOfSpanId) return;
      effects += 1;
      if (effect.recoveryState === "recoverable") recoverable += 1;
      if (
        effect.outcome === "unknown" ||
        effect.recoveryState === "ambiguous"
      ) {
        ambiguous += 1;
      }
    });
  }
  return {
    effects,
    recoverable,
    ambiguous,
    label: `${effects} ${effects === 1 ? "effect" : "effects"} · ${recoverable} recoverable · ${ambiguous} ambiguous`,
  };
}

function effectReceipt(
  node: ObservabilityRunDetailNode,
): Readonly<Record<string, unknown>> | undefined {
  for (const artifact of node.artifacts ?? []) {
    if (artifact.kind !== "effect.receipt") continue;
    const preview = recordValue(artifact.preview);
    if (preview?.kind === "effect.receipt") return preview;
  }
  return undefined;
}

function recoveryState(recovery: string): EffectRecoveryState {
  switch (recovery) {
    case "available":
      return "recoverable";
    case "irreversible":
      return "irreversible";
    case "ambiguous":
      return "ambiguous";
    case "recovered":
      return "recovered";
    default:
      return "unavailable";
  }
}

function recoveryAttemptState(outcome: EffectOutcome): EffectRecoveryState {
  switch (outcome) {
    case "succeeded":
      return "recovered";
    case "unknown":
      return "ambiguous";
    default:
      return "recovery-failed";
  }
}

function recoveryTarget(node: ObservabilityRunDetailNode): string | undefined {
  const spanId = stringValue(node.spanId) ?? node.id;
  for (const relation of node.relations ?? []) {
    if (relation.edgeType !== "recovery.of") continue;
    if (graphRefId(relation.from) !== spanId) continue;
    return graphRefId(relation.to);
  }
  return undefined;
}

function linkedRecoveryAttempt(
  node: ObservabilityRunDetailNode,
  root: ObservabilityRunDetailNode | undefined,
): EffectRunPresentation | undefined {
  if (!root) return undefined;
  const spanId = stringValue(node.spanId) ?? node.id;
  let latest:
    | { readonly createdAt: string; readonly attempt: EffectRunPresentation }
    | undefined;
  for (const relation of node.relations ?? []) {
    if (
      relation.edgeType !== "recovery.of" ||
      graphRefId(relation.to) !== spanId
    ) {
      continue;
    }
    const attemptId = graphRefId(relation.from);
    const attempt = attemptId ? findNodeBySpanId(root, attemptId) : undefined;
    const presentation = attempt ? projectEffectRun(attempt) : undefined;
    if (!presentation) continue;
    if (!latest || relation.createdAt >= latest.createdAt) {
      latest = { createdAt: relation.createdAt, attempt: presentation };
    }
  }
  return latest?.attempt;
}

function findNodeBySpanId(
  node: ObservabilityRunDetailNode,
  spanId: string,
): ObservabilityRunDetailNode | undefined {
  if ((stringValue(node.spanId) ?? node.id) === spanId) return node;
  for (const child of node.children ?? []) {
    const found = findNodeBySpanId(child, spanId);
    if (found) return found;
  }
  return undefined;
}

function visitNodes(
  node: ObservabilityRunDetailNode,
  visit: (node: ObservabilityRunDetailNode) => void,
): void {
  visit(node);
  for (const child of node.children ?? []) visitNodes(child, visit);
}

function graphRefId(value: unknown): string | undefined {
  return stringValue(recordValue(value)?.id);
}

function resourceSummary(
  value: unknown,
): EffectResourceSummary | readonly EffectResourceSummary[] | undefined {
  if (Array.isArray(value)) {
    const resources = value
      .map((entry) => resourceSummary(entry))
      .filter((entry): entry is EffectResourceSummary => !Array.isArray(entry) && Boolean(entry));
    return resources.length > 0 ? resources : undefined;
  }
  const resource = recordValue(value);
  const type = stringValue(resource?.type);
  if (!type) return undefined;
  const id = stringValue(resource?.id);
  const namespace = stringValue(resource?.namespace);
  const attributes = primitiveAttributes(resource?.attributes);
  return {
    type,
    ...(id ? { id } : {}),
    ...(namespace ? { namespace } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

function primitiveAttributes(
  value: unknown,
): Readonly<Record<string, string | number | boolean>> | undefined {
  const input = recordValue(value);
  if (!input) return undefined;
  const output: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function recordValue(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : undefined;
}
