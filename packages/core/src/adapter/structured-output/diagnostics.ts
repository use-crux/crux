/**
 * Structured-output compilation diagnostics.
 *
 * Diagnostics are stable, machine-readable notes about compatible compilation
 * decisions: which lowering rules were applied and which semantics were
 * deliberately approximated or dropped. Fatal, unrepresentable semantics are not
 * diagnostics — they are thrown errors (see `./errors`).
 *
 * @module
 */

/**
 * Stable machine code for a compilation diagnostic.
 *
 * Codes are append-only: never repurpose an existing code's meaning.
 */
export type StructuredOutputDiagnosticCode =
  | "lowered-optional-to-nullable"
  | "dropped-unsupported-keyword"
  | "approximated-semantic";

/** A single compatible compilation decision, addressed by canonical path. */
export interface StructuredOutputDiagnostic {
  /** Stable machine code identifying the kind of decision. */
  readonly code: StructuredOutputDiagnosticCode;
  /** Concise, user-facing description without leaking sensitive content. */
  readonly message: string;
  /** Canonical path of the affected occurrence, when the decision is local. */
  readonly path?: readonly (string | number)[];
}
