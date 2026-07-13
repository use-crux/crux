/**
 * Presentational helpers for deferred-work spans in Run Detail.
 *
 * Surfaces intent lifecycle and host completion class honestly so Devtools
 * never implies response-finished reliability for handler-returned hosts.
 */

export type DeferredIntentState =
  | "staged"
  | "released"
  | "abandoned"
  | "running"
  | "completed"
  | "failed"
  | "timed-out"
  | "cancelled";

export interface DeferredSpanPresentation {
  readonly mode?: "inline" | "named";
  readonly completion?: "response-finished" | "handler-returned";
  readonly intentState?: DeferredIntentState;
  readonly outcome?: DeferredIntentState;
  readonly workId?: string;
  readonly targetId?: string;
  readonly sequence?: number;
  readonly streamingNote?: string;
  readonly stateLabel?: string;
}

/** Read deferred-work attributes from a span attribute bag. */
export function deferPresentationFromAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
  primitive: string | undefined,
): DeferredSpanPresentation | undefined {
  if (!primitive?.startsWith("defer.")) return undefined;
  const mode = stringEnum(attributes?.mode, ["inline", "named"] as const);
  const completion = stringEnum(attributes?.completion, [
    "response-finished",
    "handler-returned",
  ] as const);
  const intentState = stringEnum(attributes?.intentState, [
    "staged",
    "released",
    "abandoned",
  ] as const);
  const outcome = stringEnum(attributes?.outcome, [
    "completed",
    "failed",
    "timed-out",
    "cancelled",
  ] as const);
  const workId = stringValue(attributes?.workId);
  const targetId = stringValue(attributes?.targetId);
  const sequence =
    typeof attributes?.sequence === "number" ? attributes.sequence : undefined;

  const stateLabel =
    intentState ??
    outcome ??
    (primitive === "defer.scheduled" ? "scheduled" : "running");

  const streamingNote =
    completion === "handler-returned"
      ? "Host completion is handler-returned: deferred work may overlap the response body stream."
      : completion === "response-finished"
        ? "Host completion is response-finished: deferred work starts after the response finishes."
        : undefined;

  return {
    ...(mode ? { mode } : {}),
    ...(completion ? { completion } : {}),
    ...(intentState ? { intentState } : {}),
    ...(outcome ? { outcome } : {}),
    ...(workId ? { workId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
    ...(streamingNote ? { streamingNote } : {}),
    ...(stateLabel ? { stateLabel } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  if (typeof value !== "string") return undefined;
  return (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}
