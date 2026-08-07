/**
 * Structured-output compilation plan and decode manifest types.
 *
 * A plan is the immutable output of compiling one authored schema against one
 * capability profile: the lowered wire schema, the reversible decode manifest,
 * compilation diagnostics, and a stable fingerprint. The manifest is closed,
 * versioned, serializable data sufficient to decode a provider value back to
 * canonical `z.input` without the provider SDK or the authored Zod schema.
 *
 * @module
 */

import type { StructuredOutputDiagnostic } from "./diagnostics";

/** A JSON Schema represented as a plain object. */
export type JsonSchemaObject = Record<string, unknown>;

export type StructuredOutputStrategy =
  | "explicit"
  | "inferred"
  | "passthrough"
  | "reject";

export type StructuredOutputResolution =
  | {
      readonly strategy: "explicit" | "inferred";
      readonly profileId: string;
      readonly capabilities: import("./capabilities").StructuredOutputCapabilities;
    }
  | { readonly strategy: "passthrough"; readonly profileId: string }
  | { readonly strategy: "reject"; readonly profileId: string };

export interface StructuredOutputResolverContext {
  readonly model: import("../../types").ModelInfo;
  readonly usage: "output" | "tool-input";
}

/**
 * A branch condition on a decode operation recorded inside a discriminated
 * union.
 *
 * `depth` indexes into the operation's own `path`: the node reached after
 * consuming `depth` segments (the union's position, so guards stay correct
 * under array wildcards) must be an object whose `key` property equals
 * `value`, or the operation is a no-op for that value.
 */
export type StructuredOutputDecodeGuard = Readonly<{
  depth: number;
  key: string;
  value: string | number | boolean;
}>;

/**
 * A single reversible decode operation applied to a provider value before
 * Safety and original Zod parsing.
 *
 * `delete-null-sentinel` removes a property whose provider value is exactly
 * `null`, reversing the required+nullable lowering used for optional-only
 * properties. `'*'` in a path denotes every element of the current array.
 * `guards` (present for operations recorded inside discriminated-union
 * branches, ordered by ascending depth) restrict the operation to values that
 * selected that branch.
 */
export type StructuredOutputDecodeOperation = Readonly<{
  kind: "delete-null-sentinel";
  path: readonly (string | number | "*")[];
  guards?: readonly StructuredOutputDecodeGuard[];
}>;

/**
 * The closed, versioned set of reversible decode operations for one plan.
 *
 * An empty `operations` list means the provider value needs no transport
 * reversal and decoding returns the original value reference unchanged.
 */
export interface StructuredOutputDecodeManifest {
  /** Manifest schema version; bumped when the operation set changes shape. */
  readonly version: number;
  /** Reversible operations applied in stable path order before Safety. */
  readonly operations: readonly StructuredOutputDecodeOperation[];
}

/**
 * The immutable result of compiling one authored schema for one provider.
 *
 * @remarks
 * `outputSchema` is the provider-compatible lowered JSON Schema. `decodeManifest`
 * reverses transport-only changes. `diagnostics` records applied lowering,
 * deliberate approximations, and dropped keywords. `fingerprint` is a stable
 * identity over canonical schema, profile, compiler/manifest version, and
 * lowering decisions — never over request-local or non-semantic object identity.
 */
export interface StructuredOutputPlan {
  /**
   * Compiler-owned pre-lowering canonical JSON Schema — the structural shape of
   * the canonical `z.input` that object Safety operates on, before any provider
   * lowering artifacts (provider-forced `required`, `additionalProperties`,
   * optional-to-nullable). It is the authority for per-occurrence structural
   * validation; provider lowering never bleeds into Safety semantics.
   */
  readonly canonicalSchema: JsonSchemaObject;
  /** Provider-compatible JSON Schema compiled from the authored schema. */
  readonly outputSchema: JsonSchemaObject;
  /** Reversible decode operations applied to a provider value before Safety. */
  readonly decodeManifest: StructuredOutputDecodeManifest;
  /** Stable, machine-readable compilation diagnostics. */
  readonly diagnostics: readonly StructuredOutputDiagnostic[];
  /** Stable identity of this compilation, for caching and diagnostics. */
  readonly fingerprint: string;
}
