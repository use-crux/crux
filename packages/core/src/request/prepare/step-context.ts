/**
 * Immutable context exposed to per-provider-call preparation.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { RequestReceipt } from "../receipt/receipt";
import type { PreparationResources } from "./resources";

/** Safe reason for one semantic language preparation boundary. */
export type StepReason = "initial" | "tool-result" | "validation-retry";

/** Coverage for optional provider-reported statistics. */
export type PreparationCoverage = "complete" | "partial" | "none";

/** Minimal usage aggregate available during language preparation. */
export interface PreparationUsageStats {
  /** Provider-reported input tokens, absent when unknown. */
  readonly inputTokens?: number;
  /** Provider-reported output tokens, absent when unknown. */
  readonly outputTokens?: number;
  /** Provider-reported total tokens, absent when unknown. */
  readonly totalTokens?: number;
  /** Honest coverage for optional token and cost facts. */
  readonly coverage: {
    readonly tokens: PreparationCoverage;
    readonly cost: PreparationCoverage;
  };
}

/** Minimal provider-call counters for the current managed run. */
export interface PreparationModelCallStats {
  /** Provider calls started before the current boundary. */
  readonly started: number;
  /** Provider calls completed successfully before the current boundary. */
  readonly succeeded: number;
  /** Provider calls that failed before the current boundary. */
  readonly failed: number;
  /** Provider calls cancelled before the current boundary. */
  readonly cancelled: number;
  /** Exact transport retries reported for prior sealed requests. */
  readonly transportRetries: number;
}

/** Minimal in-memory scope aggregate used by preparation V1. */
export interface PreparationScopeStats {
  /** Honest aggregate usage with explicit coverage. */
  readonly usage: PreparationUsageStats;
  /** Provider-call lifecycle counts. */
  readonly modelCalls: PreparationModelCallStats;
}

/** Safe attempt facts for one preparation boundary. */
export interface PreparationAttemptStats {
  /** One-based candidate attempt within this boundary. */
  readonly number: number;
  /** Safe classification for this candidate attempt. */
  readonly reason: "initial" | "retry" | "fallback" | "validation-retry";
}

/** Statistics snapshot supplied to `prepareStep`. */
export interface StepPreparationStats {
  /** Time at which Core took this immutable snapshot. */
  readonly at: Date;
  /** In-memory activity cursor for this managed run. */
  readonly cursor: number;
  /** Current candidate attempt facts. */
  readonly attempt: PreparationAttemptStats;
  /** Aggregate for the managed run currently being controlled. */
  readonly run: PreparationScopeStats;
  /** Aggregate for the outer activity root. */
  readonly root: PreparationScopeStats;
  /** Zero-based semantic provider-call index. */
  readonly stepIndex: number;
}

/** One normalized Tool lifecycle fact visible to preparation. */
export interface StepToolHistoryEntry {
  /** Provider-neutral Tool call identity. */
  readonly callId: string;
  /** Registered Tool name. */
  readonly name: string;
  /** Canonical Tool result, absent until the call completes. */
  readonly result?: unknown;
}

/**
 * Immutable provider-neutral context for one language provider call.
 *
 * It exposes the canonical transcript for observation, never as replacement
 * authority. Resource access is read-only and pinned to this boundary.
 */
export interface StepContext {
  /** Operation family for this callback. */
  readonly operation: "language";
  /** Original normalized invocation input. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Zero-based semantic provider-call index. */
  readonly index: number;
  /** Why this provider-call boundary exists. */
  readonly reason: StepReason;
  /** Receipt for the preceding semantic provider call, when present. */
  readonly previousReceipt: RequestReceipt | undefined;
  /** Immutable canonical transcript visible at this boundary. */
  readonly messages: readonly Message[];
  /** Normalized Tool lifecycle projected from {@link messages}. */
  readonly toolHistory: readonly StepToolHistoryEntry[];
  /** Minimal in-memory statistics snapshot. */
  readonly stats: StepPreparationStats;
  /** Read-only mediator for declared structured resources. */
  readonly resources: PreparationResources;
  /** Signal bounded by caller cancellation and the preparation deadline. */
  readonly signal: AbortSignal;
}

/** Freeze a StepContext and its Core-owned snapshots. @internal */
export function createStepContext(input: StepContext): StepContext {
  return Object.freeze({
    ...input,
    input: freezePlain(input.input),
    messages: freezePlain([...input.messages]),
    toolHistory: Object.freeze(input.toolHistory.map((entry) => freezePlain(entry))),
    stats: freezePlain(input.stats),
  });
}

/** Project normalized Tool lifecycle facts from the canonical transcript. @internal */
export function stepToolHistory(
  messages: readonly Message[],
): readonly StepToolHistoryEntry[] {
  const calls = new Map<string, StepToolHistoryEntry>();
  for (const message of messages) {
    if (message.role === "assistant") {
      const metadata = record(message.metadata);
      const toolCalls = Array.isArray(metadata?.toolCalls)
        ? metadata.toolCalls
        : [];
      for (const value of toolCalls) {
        const call = record(value);
        if (
          typeof call?.id === "string" &&
          typeof call.name === "string"
        ) {
          calls.set(
            call.id,
            Object.freeze({ callId: call.id, name: call.name }),
          );
        }
      }
      continue;
    }
    if (message.role !== "tool") continue;
    const metadata = record(message.metadata);
    const callId =
      typeof metadata?.toolCallId === "string"
        ? metadata.toolCallId
        : undefined;
    const name =
      typeof metadata?.toolName === "string"
        ? metadata.toolName
        : callId
          ? calls.get(callId)?.name
          : undefined;
    if (!callId || !name) continue;
    calls.set(
      callId,
      Object.freeze({
        callId,
        name,
        result: message.content,
      }),
    );
  }
  return Object.freeze([...calls.values()]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function freezePlain<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezePlain(entry))) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = freezePlain(entry);
  }
  return Object.freeze(copy) as T;
}
