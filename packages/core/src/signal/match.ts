/**
 * Typed Signal match data.
 *
 * @module
 */

import type { JsonPrimitive, JsonValue } from "../storage/types";

/**
 * Canonical equality fields used to filter a normalized Signal payload.
 *
 * @remarks Scalars and arrays are exact values. Object fields are partial and
 * may be nested. Matching runs against normalized schema output.
 */
export type SignalMatch<T> = T extends JsonPrimitive
  ? T
  : T extends readonly JsonValue[]
    ? T
    : T extends object
      ? {
          readonly [K in keyof T]?: SignalMatch<Exclude<T[K], undefined>>;
        }
      : never;
