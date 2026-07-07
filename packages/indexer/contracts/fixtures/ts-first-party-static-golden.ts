/**
 * Shared fixture types for the TypeScript first-party static reference golden.
 *
 * The fixture stores canonical per-file digests instead of the full fact payload
 * so the P5 Rust-default cutover has an exact baseline without adding megabytes
 * of duplicated generated facts.
 *
 * @module
 */

/** Golden digest for one file in the TypeScript first-party static reference baseline. */
export interface TsFirstPartyStaticGoldenFileFixture {
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

/** Totals for the TypeScript first-party static reference baseline. */
export interface TsFirstPartyStaticGoldenTotalsFixture {
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

/** Shared TypeScript first-party static reference output golden. */
export interface TsFirstPartyStaticGoldenSharedFixture {
  /** Fixture schema version. */
  readonly schemaVersion: 1;
  /** Frontend that produced this baseline before P5.4 deletion. */
  readonly frontend: "typescript";
  /** Placeholder used for absolute repo-root paths before hashing. */
  readonly rootPlaceholder: "<repo>";
  /** Production file selector used to choose the corpus. */
  readonly fileSelection: "staticDefinitionFiles(root)";
  /** Canonical projection contract hashed for each file. */
  readonly projection: "canonicalStaticExtractionJson(definitions,relations,diagnostics,dependencies)";
  /** Aggregate counts for quick regression checks. */
  readonly totals: TsFirstPartyStaticGoldenTotalsFixture;
  /** Per-file canonical projection hashes. */
  readonly files: readonly TsFirstPartyStaticGoldenFileFixture[];
}
