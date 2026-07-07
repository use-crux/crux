/**
 * Runtime artifact manifest contracts.
 *
 * Crux tooling writes these manifests before generating host entry files. The
 * manifest is intentionally small: durable target names are the routing
 * contract, while module/export fields are build-time import instructions.
 *
 * @module
 */

/** Runtime target kinds reserved by the artifact manifest. */
export type RuntimeArtifactTargetKind = 'flow' | 'task' | 'watcher' | 'trigger'

/** One statically importable runtime target. */
export interface RuntimeArtifactManifestTarget {
  /** Stable durable target id from `flow("name")` or `durableTask("name")`. */
  readonly name: string
  /** Runtime target family. v1 generation emits only `flow` and `task`. */
  readonly kind: RuntimeArtifactTargetKind
  /** Project-root-relative module path, for example `./src/flows/review.ts`. */
  readonly module: string
  /** Exported binding that generated entry files import. */
  readonly export: string
}

/** Versioned runtime artifact manifest written to `.crux/generated/runtime/manifest.json`. */
export interface RuntimeArtifactManifest {
  /** Manifest schema version. */
  readonly version: 1
  /** Deterministically sorted runtime targets. */
  readonly targets: readonly RuntimeArtifactManifestTarget[]
}
