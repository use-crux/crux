/**
 * Local Flow signals and static Signal source declarations.
 *
 * A Flow signal map can contain local named contracts for `flow.suspend()` and
 * `handle.signal()`, static Signal sources for `flow.waitFor(source)`, or both.
 *
 * @module
 */

import type { JsonValue } from "../storage";
import type { StaticSignalSource } from "../signal/source";
import type { ZodError, ZodType } from "zod";

const NO_PAYLOAD_SIGNAL_TAG = "crux.flow.no_payload" as const;

/** Marker for a local Flow signal that accepts no payload. */
export interface NoPayloadSignal {
  /** Stable local no-payload declaration discriminant. */
  readonly _tag: typeof NO_PAYLOAD_SIGNAL_TAG;
}

/**
 * Runtime contract for one local Flow signal.
 *
 * @remarks Use a Zod schema for payload validation or {@link noPayload} for a
 * notification with no payload argument.
 * @typeParam TPayload - Parsed payload delivered by the local signal.
 */
export type FlowSignalSpec<TPayload = unknown> =
  | ZodType<TPayload>
  | NoPayloadSignal;

/** One local Flow signal contract or static Signal consumer source. */
export type FlowSignalDeclaration = FlowSignalSpec | StaticSignalSource;

/**
 * Mixed local and static Signal declarations keyed by authored names.
 *
 * @remarks Static entries are values for `flow.waitFor(source)`, not local
 * names for `flow.suspend(name)` or `handle.signal()`.
 */
export type FlowSignalMap = Readonly<Record<string, FlowSignalDeclaration>>;

/**
 * Static Signal source values declared by one Flow signal map.
 *
 * @typeParam TSignals - Mixed declaration map owned by one Flow.
 */
export type DeclaredFlowSignalSource<TSignals extends FlowSignalMap> = Extract<
  TSignals[keyof TSignals],
  StaticSignalSource
>;

/**
 * Definition-time options accepted by `flow(name, options, handler)`.
 *
 * @typeParam TSignals - Mixed declarations available to this Flow.
 */
export interface FlowDefinitionOptions<
  TSignals extends FlowSignalMap = FlowSignalMap,
> {
  /** Local contracts and statically deployed sources for this Flow only. */
  readonly signals: TSignals;
}

/**
 * Infer the parsed payload delivered by a local Flow signal declaration.
 *
 * @typeParam TSpec - Zod or no-payload local declaration.
 */
export type FlowSignalPayload<TSpec> =
  TSpec extends ZodType<infer TPayload>
    ? TPayload
    : TSpec extends NoPayloadSignal
      ? void
      : never;

/** Options for {@link FlowHandle.signal} local delivery. */
export interface FlowSignalOptions {
  /**
   * Whether the configured Runtime Engine should be nudged immediately.
   *
   * Set to `false` to record through the configured Runtime without nudging
   * it, then resume later with `FlowHandle.resume(flowId)`.
   *
   * @defaultValue `true` when the options object is omitted.
   */
  readonly resume: boolean;
}

/** Call arguments inferred for payload-bearing and no-payload local sends. */
export type FlowSignalPayloadArgs<TPayload> = [TPayload] extends [void]
  ? [options?: FlowSignalOptions]
  : [payload: TPayload, options?: FlowSignalOptions];

/** Untyped signal sends stay available for flows without a local signal map. */
export type UntypedSignalPayloadArgs = [
  payload?: JsonValue,
  options?: FlowSignalOptions,
];

const NO_PAYLOAD_SIGNAL = Object.freeze({
  _tag: NO_PAYLOAD_SIGNAL_TAG,
}) satisfies NoPayloadSignal;

/**
 * Declare that a local Flow signal carries no payload.
 *
 * @remarks The returned frozen marker is reusable. It affects only local
 * `suspend(name)` and `handle.signal()` inference.
 * @returns A reusable marker for a signal-map entry.
 *
 * @example
 * ```ts
 * import { flow, noPayload } from "@use-crux/core/flow";
 *
 * const review = flow(
 *   'review',
 *   { signals: { cancel: noPayload() } },
 *   async (flow) => {
 *     await flow.suspend('cancel')
 *   },
 * )
 *
 * const started = await review.run()
 * if (started.status === 'suspended') {
 *   await review.signal(started.flowId, 'cancel')
 * }
 * ```
 */
export function noPayload(): NoPayloadSignal {
  return NO_PAYLOAD_SIGNAL;
}

/** Return true when a signal declaration was created by {@link noPayload}. */
export function isNoPayloadSignal(value: unknown): value is NoPayloadSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { readonly _tag?: unknown })._tag === NO_PAYLOAD_SIGNAL_TAG
  );
}

/** Return the runtime schema for a signal declaration, if it has one. */
export function signalSchemaFor(
  spec: FlowSignalDeclaration | undefined,
): ZodType<unknown> | undefined {
  if (!spec || isNoPayloadSignal(spec)) return undefined;
  if (
    "_tag" in spec &&
    (spec._tag === "Signal" || spec._tag === "FilteredSignal")
  ) {
    return undefined;
  }
  return spec as ZodType<unknown>;
}

/**
 * Error thrown when a local Flow signal payload violates its declaration.
 *
 * @remarks This error belongs to `handle.signal()`/`suspend(name)` delivery.
 * Signal publication schema failures use `SignalValidationError` instead.
 */
export class InvalidSignalPayloadError extends Error {
  /** Authored local Flow signal name whose payload failed validation. */
  readonly signalName: string;

  /**
   * Create a local Flow signal validation error.
   *
   * @param signalName - Authored local signal name.
   * @param detail - Schema failure detail used in the error message.
   */
  constructor(signalName: string, detail: string) {
    super(`Invalid signal payload for "${signalName}": ${detail}`);
    this.name = "InvalidSignalPayloadError";
    this.signalName = signalName;
  }
}

/**
 * Validate a payload against a declared local signal schema.
 *
 * Local signal maps are runtime contracts as well as type contracts. This
 * helper keeps schema parsing near the signal declaration utilities so the
 * flow executor can stay focused on lifecycle control.
 *
 * @param signalName - Local signal name being delivered.
 * @param spec - Signal declaration from the flow's local signal map.
 * @param payload - Payload supplied by a caller or loaded from persistence.
 * @returns The parsed payload when a schema exists, or the original payload.
 */
export function validateSignalPayload(
  signalName: string,
  spec: FlowSignalDeclaration | undefined,
  payload: unknown,
): unknown {
  if (isNoPayloadSignal(spec)) {
    if (isEmptySignalPayload(payload)) return payload;
    throw new InvalidSignalPayloadError(signalName, "expected no payload");
  }

  const schema = signalSchemaFor(spec);
  if (!schema) return payload;

  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  throw new InvalidSignalPayloadError(
    signalName,
    formatSignalPayloadIssues(result.error),
  );
}

function isEmptySignalPayload(payload: unknown): boolean {
  if (payload === undefined || payload === null) return true;
  if (!isPlainRecord(payload)) return false;
  return Object.keys(payload).length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatSignalPayloadIssues(error: ZodError<unknown>): string {
  if (error.issues.length === 0) return error.message;
  return error.issues.map(formatSignalPayloadIssue).join("; ");
}

function formatSignalPayloadIssue(
  issue: ZodError<unknown>["issues"][number],
): string {
  const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
  return `${issue.message}${path}`;
}
