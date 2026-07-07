/**
 * Shared fixture types for the Rust first-party static golden.
 *
 * The fixture stores canonical per-file digests instead of the full fact
 * payload so Rust-owned bundled indexing has an exact regression oracle
 * without checking in megabytes of generated facts.
 *
 * @module
 */

/** Golden digest for one file in the Rust first-party static baseline. */
export interface RustFirstPartyStaticGoldenFileFixture {
  /** Root-relative POSIX path for the indexed source file. */
  readonly file: string;
  /** SHA-256 of the root-stable canonical static extraction projection. */
  readonly sha256: string;
  /** Byte length of the canonical static extraction projection. */
  readonly bytes: number;
  /** Definition count in the file projection. */
  readonly definitions: number;
  /** Relation count in the file projection. */
  readonly relations: number;
  /** Diagnostic count in the file projection. */
  readonly diagnostics: number;
  /** Dependency count in the file projection. */
  readonly dependencies: number;
}

/** Totals for the Rust first-party static baseline. */
export interface RustFirstPartyStaticGoldenTotalsFixture {
  /** Number of files selected by production static discovery. */
  readonly files: number;
  /** Total definitions in the canonical baseline. */
  readonly definitions: number;
  /** Total relations in the canonical baseline. */
  readonly relations: number;
  /** Total diagnostics in the canonical baseline. */
  readonly diagnostics: number;
  /** Total dependencies in the canonical baseline. */
  readonly dependencies: number;
  /** Total canonical JSON bytes covered by all file hashes. */
  readonly canonicalBytes: number;
}

/** Shared Rust first-party static golden. */
export interface RustFirstPartyStaticGoldenSharedFixture {
  /** Fixture schema version. */
  readonly schemaVersion: 1;
  /** Frontend that produced this bundled baseline. */
  readonly frontend: "oxc-rust";
  /** Placeholder used for absolute repo-root paths before hashing. */
  readonly rootPlaceholder: "<repo>";
  /** Production file selector used to choose the corpus. */
  readonly fileSelection: "staticDefinitionFiles(root)";
  /** Canonical projection contract hashed for each file. */
  readonly projection: "canonicalStaticExtractionJson(definitions,relations,diagnostics,dependencies)";
  /** Aggregate counts for quick regression checks. */
  readonly totals: RustFirstPartyStaticGoldenTotalsFixture;
  /** Per-file canonical projection hashes. */
  readonly files: readonly RustFirstPartyStaticGoldenFileFixture[];
}
