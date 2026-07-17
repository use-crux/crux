import type { CorrelatedEvent } from "@/types";

export interface ToolExecutionInfo {
  durationMs?: number;
  result?: unknown;
  modelOutput?: unknown;
  modelOutputType?: string;
  outputSize?: number;
  modelOutputSize?: number;
  tokenSavingsEstimate?: number;
  modelOutputError?: string;
  error?: string;
  estimated?: boolean;
  status: "running" | "done" | "error";
}

export interface DelegateExecutionInfo {
  durationMs?: number;
  handoffId?: string;
  inputSize?: number;
  outputSize?: number;
  fromAgent?: string;
  toAgent?: string;
}

export function buildToolExecutionMap(
  correlatedEvents: readonly CorrelatedEvent[],
): Map<string, ToolExecutionInfo> {
  const map = new Map<string, ToolExecutionInfo>();
  for (const event of correlatedEvents) {
    if (event.eventType === "tool:start") {
      const key = String(event.data.toolCallId ?? event.data.toolName ?? "");
      if (key && !map.has(key)) {
        map.set(key, { status: "running" });
      }
    } else if (event.eventType === "tool:end") {
      const key = String(event.data.toolCallId ?? event.data.toolName ?? "");
      if (key) {
        map.set(key, {
          durationMs: event.data.durationMs as number | undefined,
          result: event.data.result,
          modelOutput: event.data.modelOutput,
          modelOutputType: event.data.modelOutputType as string | undefined,
          outputSize: event.data.outputSize as number | undefined,
          modelOutputSize: event.data.modelOutputSize as number | undefined,
          tokenSavingsEstimate: event.data.tokenSavingsEstimate as
            | number
            | undefined,
          modelOutputError: event.data.modelOutputError as string | undefined,
          error: event.data.error as string | undefined,
          estimated: event.data.estimated as boolean | undefined,
          status: event.data.error ? "error" : "done",
        });
      }
    }
  }
  return map;
}

export function buildDelegateExecutionMap(
  correlatedEvents: readonly CorrelatedEvent[],
): Map<string, DelegateExecutionInfo> {
  const map = new Map<string, DelegateExecutionInfo>();
  for (const event of correlatedEvents) {
    if (event.eventType === "delegate:start") {
      const id = String(event.data.delegateId ?? "");
      if (id) {
        map.set(id, {
          handoffId: event.data.handoffId as string | undefined,
          inputSize: event.data.inputSize as number | undefined,
        });
      }
    } else if (event.eventType === "delegate:complete") {
      const id = String(event.data.delegateId ?? "");
      if (id) {
        const existing = map.get(id) ?? {};
        map.set(id, {
          ...existing,
          durationMs: event.data.durationMs as number | undefined,
          outputSize: event.data.outputSize as number | undefined,
        });
      }
    } else if (event.eventType === "handoff:prepare") {
      for (const [, value] of map) {
        if (value.handoffId === event.data.handoffId) {
          value.fromAgent = event.data.fromAgent as string | undefined;
          value.toAgent = event.data.toAgent as string | undefined;
          if (!value.outputSize)
            value.outputSize = event.data.outputSize as number | undefined;
        }
      }
    }
  }
  return map;
}
