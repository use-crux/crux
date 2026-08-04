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

/**
 * One statically importable executable Signal provider.
 *
 * @remarks Process authority only. The manifest retains secret-free identity and
 * import coordinates; live `handle`/`onEvent` callbacks remain on the imported
 * module and never enter the inert transport binding projection.
 */
export interface RuntimeArtifactManifestProvider {
  /** Stable application-owned provider id from `signalProvider({ id })`. */
  readonly id: string;
  /** Project-root-relative module path. */
  readonly module: string;
  /** Exported binding that generated programs import. */
  readonly export: string;
  /** Exact Project Index definition identity. */
  readonly definitionId: string;
  /** Exact Project Index definition fingerprint. */
  readonly fingerprint: string;
}

/**
 * One statically importable inert managed-transport binding.
 *
 * @remarks Declaration data only. Credentials, Requests, clients, sockets, and
 * callbacks never appear in generated binding imports or manifest fields.
 */
export interface RuntimeArtifactManifestTransport {
  /** Stable binding id retained by the Runtime program. */
  readonly id: string;
  /** Project-root-relative module path. */
  readonly module: string;
  /** Exported binding that generated programs import. */
  readonly export: string;
  /** Exact Project Index definition identity. */
  readonly definitionId: string;
  /** Exact Project Index definition fingerprint. */
  readonly fingerprint: string;
  /** Secret-free provider identity required as executable program authority. */
  readonly providerId: string;
  /** Signal definition id this binding routes toward. */
  readonly signalId: string;
}

/** Versioned runtime artifact manifest written to `.crux/generated/runtime/manifest.json`. */
export interface RuntimeArtifactManifest {
  /** Manifest schema version. */
  readonly version: 3;
  /** Secret-free identity of the generated Eval persistence policy. */
  readonly evalPrivacyFingerprint: string;
  /** Deterministically sorted runtime targets. */
  readonly targets: readonly RuntimeArtifactManifestTarget[];
  /**
   * Deterministically sorted executable Signal providers.
   *
   * @remarks Empty when the project declares no managed transports. Non-empty
   * transports require matching provider authority before worker start.
   */
  readonly providers: readonly RuntimeArtifactManifestProvider[];
  /**
   * Deterministically sorted inert managed-transport bindings.
   *
   * @remarks Secret-free. Each entry requires a matching program provider.
   */
  readonly transports: readonly RuntimeArtifactManifestTransport[];
  /** Deterministically sorted deployed Eval identities. */
  readonly evals: readonly RuntimeArtifactManifestEval[];
}
