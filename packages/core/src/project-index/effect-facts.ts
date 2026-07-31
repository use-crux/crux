/**
 * Static Project Index facts for custom Effects.
 *
 * @module
 */

/** Whether static syntax proves that an Effect option is present. */
export type EffectStaticPresence = boolean | "unknown";

/** Facts extracted from an `effect(id, executor, options?)` definition. */
export interface EffectFacts {
  readonly kind: "effect";
  /** Authored Effect id when the first argument is a string literal. */
  readonly effectId?: string;
  /** Authored version, or the default version `1`, when statically known. */
  readonly version?: number;
  /** Whether recovery is configured on a literal options object. */
  readonly recoverable: EffectStaticPresence;
  /** Whether recovery uses the `{ capture, execute }` form. */
  readonly capture: EffectStaticPresence;
  /** Whether a resource projection is configured. */
  readonly resource: EffectStaticPresence;
}
