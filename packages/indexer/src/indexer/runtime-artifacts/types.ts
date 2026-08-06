import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import type { ProjectDefinition } from "@use-crux/core/project-index";

export type RuntimeArtifactHost = "next" | "convex" | "cloudflare";

/** One stable child explanation from Runtime artifact planning or commit. */
export interface RuntimeArtifactFinding {
  readonly code: string;
  readonly category: "authored" | "configuration" | "environment" | "internal";
  readonly featureKind?:
    | "eval"
    | "runtime"
    | "target"
    | "generated-file"
    | "provider"
    | "transport";
  readonly featureId?: string;
  readonly arm?: string;
  readonly source?: string;
  readonly summary: string;
  readonly reason: string;
  readonly whatStillWorks?: string;
  readonly remediation?: string;
  readonly docs?: string;
}

/** Options for generating runtime target manifests and host entry files. */
export interface GenerateRuntimeArtifactsOptions {
  /** Project root containing authored Crux source files. */
  readonly root: string;
  /**
   * Project Index definitions to project into runtime targets.
   *
   * The local runtime supplies these from the native Project Index snapshot.
   * This generator intentionally does not parse source files or run bundled
   * extraction in-process.
   */
  readonly definitions?: readonly ProjectDefinition[];
  /** Runtime host entry to generate. Defaults to `config({ runtime })` or Next. */
  readonly host?: RuntimeArtifactHost;
}

/** Result of a runtime artifact generation pass. */
export interface RuntimeArtifactGenerationResult {
  /** Deterministic runtime target manifest written to `.crux/generated/runtime/manifest.json`. */
  readonly manifest: RuntimeArtifactManifest;
  /** SHA-256 hash of the canonical manifest contents, excluding generated entry files. */
  readonly contentHash: string;
  /** Absolute files written by this generation pass. */
  readonly writtenFiles: readonly string[];
}

/** Drift report for non-terminal durable work whose target is absent from the manifest. */
export interface RuntimeArtifactDriftReport {
  /** Target ids that still have non-terminal durable work but are missing from generated artifacts. */
  readonly missingTargets: readonly RuntimeArtifactMissingTarget[];
}

/** One missing target and the affected non-terminal work count. */
export interface RuntimeArtifactMissingTarget {
  /** Durable target id stored on pending/suspended work. */
  readonly targetId: string;
  /** Count of non-terminal work records that still reference the target. */
  readonly count: number;
}
