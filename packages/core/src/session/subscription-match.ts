/** Canonical match identity for durable Session Signal subscriptions. */

import type { JsonValue } from "../storage";
import {
  canonicalSignalJson,
  canonicalizeSignalJson,
} from "../signal/canonical-json";

/**
 * Build the stable match identity for one Session Signal subscription.
 *
 * @remarks Empty string means an unfiltered bare Signal subscription. Match
 * objects are key-order independent through the Signal canonical codec.
 */
export function sessionSubscriptionMatchKey(
  match: JsonValue | undefined,
): string {
  if (match === undefined) return "";
  return canonicalSignalJson(
    canonicalizeSignalJson(match, "match"),
  );
}

/**
 * Detach and canonicalize match data retained on a subscription record.
 *
 * @returns `undefined` for unfiltered subscriptions.
 */
export function sessionSubscriptionMatchValue(
  match: JsonValue | undefined,
): JsonValue | undefined {
  if (match === undefined) return undefined;
  return canonicalizeSignalJson(match, "match");
}
