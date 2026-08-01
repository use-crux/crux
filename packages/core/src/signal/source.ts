/**
 * Static Signal source types shared with durable Flow waits.
 *
 * @module
 */

import type { Signal } from "./definition";
import type { MatchSignalView, PredicateSignalView } from "./filter";
import type { SignalOccurrence } from "./publication";
import type { JsonValue } from "../storage";
import { createRuntimeError } from "../runtime/engine/errors";
import type { InferSignalSchemaOutput, SignalSchema } from "./schema-types";
import { decodeSignalPayload } from "../runtime/reactive/payload-codec";

interface AnySignalSource {
  readonly _tag: "Signal";
  readonly id: string;
  readonly schema: SignalSchema;
}

/**
 * A bare or filtered Signal source deployable as a static Flow binding.
 *
 * @remarks This minimal structural bound preserves assignability for specific
 * schemas. It is not an extension protocol or mutable registry.
 */
export type StaticSignalSource =
  | AnySignalSource
  | {
      readonly _tag: "FilteredSignal";
      readonly filterKind: "match" | "predicate";
      readonly signal: AnySignalSource;
    };

/**
 * Infer the normalized occurrence returned for a static Signal source.
 *
 * @remarks Filtered sources retain the base Signal's literal ID and normalized
 * payload type.
 */
export type SignalOccurrenceFor<TSource> =
  TSource extends Signal<infer TId, infer TSchema>
    ? SignalOccurrence<TId, InferSignalSchemaOutput<TSchema>>
    : TSource extends
          | MatchSignalView<infer TId, infer TSchema>
          | PredicateSignalView<infer TId, infer TSchema>
      ? SignalOccurrence<TId, InferSignalSchemaOutput<TSchema>>
      : never;

/** Identify the two static Signal source tags. @internal */
export function isStaticSignalSource(
  source: unknown,
): source is StaticSignalSource {
  if (source === null || typeof source !== "object") return false;
  const tag = (source as { readonly _tag?: unknown })._tag;
  return tag === "Signal" || tag === "FilteredSignal";
}

/** Return the base Signal identity for a static source. @internal */
export function signalSourceId(source: StaticSignalSource): string {
  return source._tag === "Signal" ? source.id : source.signal.id;
}

/** Return canonical match data carried by a static source. @internal */
export function signalSourceMatch(
  source: StaticSignalSource,
): JsonValue | undefined {
  return source._tag === "FilteredSignal" && source.filterKind === "match"
    ? (source as MatchSignalView).match
    : undefined;
}

/** Return deployed predicate code carried by a static source. @internal */
export function signalSourcePredicate(
  source: StaticSignalSource,
): ((payload: JsonValue) => boolean) | undefined {
  return source._tag === "FilteredSignal" && source.filterKind === "predicate"
    ? ((source as PredicateSignalView).predicate as unknown as (
        payload: JsonValue,
      ) => boolean)
    : undefined;
}

/** Decode one persisted occurrence delivered by Runtime. @internal */
export function decodeSignalOccurrence(
  value: JsonValue,
  expectedSignalId: string,
): SignalOccurrence<string, JsonValue> {
  if (
    !isJsonRecord(value) ||
    typeof value.id !== "string" ||
    value.signalId !== expectedSignalId ||
    typeof value.acceptedAt !== "string" ||
    !Object.hasOwn(value, "payload")
  ) {
    return invalidOccurrence(expectedSignalId);
  }
  const acceptedAt = new Date(value.acceptedAt);
  if (!Number.isFinite(acceptedAt.getTime())) {
    return invalidOccurrence(expectedSignalId);
  }
  const payloadCodec =
    typeof value.payloadCodec === "string" ? value.payloadCodec : undefined;
  return Object.freeze({
    id: value.id,
    signalId: expectedSignalId,
    payload: decodeSignalPayload(value.payload as JsonValue, payloadCodec),
    acceptedAt,
  });
}

function isJsonRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidOccurrence(signalId: string): never {
  throw createRuntimeError({
    code: "PAYLOAD_NOT_JSON",
    whatFailed: `Flow could not decode durable Signal occurrence \`${signalId}\`.`,
    why: "The persisted delivery does not match the Signal occurrence record contract.",
    whatStillWorks:
      "Ordinary event waits and unrelated Runtime work can still run.",
    nextStep:
      "Repair or replay the invalid delivery with a compatible Runtime store adapter.",
  });
}
