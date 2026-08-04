/**
 * Runtime artifact manifest contracts.
 *
 * Crux tooling writes these manifests before generating host entry files. The
 * manifest is intentionally small: durable target names are the routing
 * contract, definition identity pins accepted application Work, and
 * module/export fields are build-time import instructions.
 *
 * @module
 */

/** Runtime target kinds reserved by the artifact manifest. */
export type RuntimeArtifactTargetKind =
  | "flow"
  | "task"
  | "agent"
  | "watcher"
  | "trigger";

/** One statically importable runtime target. */
export interface RuntimeArtifactManifestTarget {
  /** Stable durable target id from an authored Flow, task, or Agent. */
  readonly name: string;
  /** Runtime target family emitted by generated program discovery. */
  readonly kind: RuntimeArtifactTargetKind;
  /** Project-root-relative module path, for example `./src/flows/review.ts`. */
  readonly module: string;
  /** Exported binding that generated entry files import. */
  readonly export: string;
  /** Exact Project Index definition identity. */
  readonly definitionId: string;
  /** Exact Project Index definition fingerprint. */
  readonly fingerprint: string;
}

/** One content-addressed Case identity in a generated deployed Eval. */
export interface RuntimeArtifactManifestEvalCase {
  readonly id: string;
  readonly fingerprint: string;
}

/** One Current or Variant identity in a generated deployed Eval. */
export interface RuntimeArtifactManifestEvalVariant {
  readonly name: string;
  readonly fingerprint: string;
  readonly execution: "coordinator" | "runtime";
  readonly requiredHostCapabilities: readonly string[];
}

/** One allowlisted Eval imported by a generated Runtime host entry. */
export interface RuntimeArtifactManifestEval {
  readonly id: string;
  readonly module: string;
  readonly export: "default";
  readonly evalFingerprint: string;
  readonly cases: readonly RuntimeArtifactManifestEvalCase[];
  readonly variants: readonly RuntimeArtifactManifestEvalVariant[];
  readonly requiredHostCapabilities: readonly string[];
}

/** Versioned runtime artifact manifest written to `.crux/generated/runtime/manifest.json`. */
export interface RuntimeArtifactManifest {
  /** Manifest schema version. */
  readonly version: 2;
  /** Secret-free identity of the generated Eval persistence policy. */
  readonly evalPrivacyFingerprint: string;
  /** Deterministically sorted runtime targets. */
  readonly targets: readonly RuntimeArtifactManifestTarget[];
  /** Deterministically sorted deployed Eval identities. */
  readonly evals: readonly RuntimeArtifactManifestEval[];
}
