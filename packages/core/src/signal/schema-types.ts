/**
 * Signal schema input and normalized output inference.
 *
 * @module
 */

import type { StandardSchemaV1 } from "../internal/standard-schema";
import type { JsonValue } from "../storage/types";

/** Standard Schema v1 contract accepted by {@link signal}. */
export type SignalSchema = StandardSchemaV1<unknown, JsonValue>;

/** Authored payload accepted by {@link Signal.publish}. */
export type InferSignalSchemaInput<TSchema extends SignalSchema> =
  StandardSchemaV1.InferInput<TSchema>;

/** Normalized JSON-safe payload delivered in a Signal occurrence. */
export type InferSignalSchemaOutput<TSchema extends SignalSchema> =
  StandardSchemaV1.InferOutput<TSchema>;
