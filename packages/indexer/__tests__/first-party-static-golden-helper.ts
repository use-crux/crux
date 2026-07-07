import { createHash } from "node:crypto";
import { relative } from "node:path";
import { canonicalStaticExtractionJson } from "../contracts/parity";
import { staticDefinitionFiles } from "../indexer/files";
import {
  createStaticExtraction,
  type StaticFileExtraction,
} from "../indexer/static/extraction/engine";
import type { StaticSyntaxFrontendFactory } from "../indexer/static-index/syntax";
import type {
  RustFirstPartyStaticGoldenFileFixture,
  RustFirstPartyStaticGoldenSharedFixture,
  RustFirstPartyStaticGoldenTotalsFixture,
} from "../contracts/fixtures";

interface StaticExtractionProjection {
  readonly definitions: StaticFileExtraction["definitions"];
  readonly relations: StaticFileExtraction["relations"];
  readonly diagnostics: StaticFileExtraction["diagnostics"];
  readonly dependencies: StaticFileExtraction["dependencies"];
}

interface RustFirstPartyStaticGoldenOptions {
  readonly syntaxFrontend: StaticSyntaxFrontendFactory;
}

/**
 * Regenerates the Rust-owned first-party static golden.
 *
 * The P5.4 cutover uses Rust/Oxc as the only bundled first-party extractor
 * implementation. This helper records root-independent canonical hashes rather
 * than duplicating the full fact payload, so CI can detect output drift without
 * keeping a parallel TypeScript baseline.
 */
export async function generateRustFirstPartyStaticGolden(
  root: string,
  options: RustFirstPartyStaticGoldenOptions,
): Promise<RustFirstPartyStaticGoldenSharedFixture> {
  const extraction = createStaticExtraction({
    root,
    cache: "none",
    syntaxFrontend: options.syntaxFrontend,
  });
  const files = staticDefinitionFiles(root);
  const extractedFiles = await extraction.extractFiles(files, {
    concurrency: 8,
  });
  const entries = extractedFiles
    .map((extracted) => goldenFile(root, extracted))
    .sort((left, right) => compareCodepoint(left.file, right.file));

  return {
    schemaVersion: 1,
    frontend: "oxc-rust",
    rootPlaceholder: "<repo>",
    fileSelection: "staticDefinitionFiles(root)",
    projection:
      "canonicalStaticExtractionJson(definitions,relations,diagnostics,dependencies)",
    totals: totalsFromFiles(entries),
    files: entries,
  };
}

function goldenFile(
  root: string,
  extracted: StaticFileExtraction,
): RustFirstPartyStaticGoldenFileFixture {
  const facts = rootStableGoldenValue(
    rootStableValue(projectStaticExtraction(extracted), root),
  );
  const canonicalJson = canonicalStaticExtractionJson(
    facts as Parameters<typeof canonicalStaticExtractionJson>[0],
  );
  return {
    file: rootRelativePath(root, extracted.file),
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
    bytes: Buffer.byteLength(canonicalJson),
    definitions: extracted.definitions.length,
    relations: extracted.relations.length,
    diagnostics: extracted.diagnostics.length,
    dependencies: extracted.dependencies.length,
  };
}

function projectStaticExtraction(
  extraction: StaticFileExtraction,
): StaticExtractionProjection {
  return {
    definitions: extraction.definitions,
    relations: extraction.relations,
    diagnostics: extraction.diagnostics,
    dependencies: extraction.dependencies,
  };
}

function totalsFromFiles(
  files: readonly RustFirstPartyStaticGoldenFileFixture[],
): RustFirstPartyStaticGoldenTotalsFixture {
  return files.reduce<RustFirstPartyStaticGoldenTotalsFixture>(
    (totals, file) => ({
      files: totals.files + 1,
      definitions: totals.definitions + file.definitions,
      relations: totals.relations + file.relations,
      diagnostics: totals.diagnostics + file.diagnostics,
      dependencies: totals.dependencies + file.dependencies,
      canonicalBytes: totals.canonicalBytes + file.bytes,
    }),
    {
      files: 0,
      definitions: 0,
      relations: 0,
      diagnostics: 0,
      dependencies: 0,
      canonicalBytes: 0,
    },
  );
}

function rootStableValue(value: unknown, root: string): unknown {
  if (typeof value === "string") return rootStableString(value, root);
  if (Array.isArray(value))
    return value.map((item) => rootStableValue(item, root));
  if (!value || typeof value !== "object") return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) normalized[key] = rootStableValue(child, root);
  }
  return normalized;
}

function rootStableString(value: string, root: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedValue = normalizePath(value);
  if (normalizedValue === normalizedRoot) return "<repo>";
  if (normalizedValue.startsWith(`${normalizedRoot}/`)) {
    return `<repo>/${normalizedValue.slice(normalizedRoot.length + 1)}`;
  }
  return normalizedValue;
}

/**
 * Removes values that are derived before root placeholder normalization.
 *
 * Rust native definition fingerprints currently include the absolute source
 * file path. The public fact still carries the real fingerprint, but the
 * golden stores per-file hashes that must be stable across checkout roots.
 */
function rootStableGoldenValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => rootStableGoldenValue(item));
  if (!value || typeof value !== "object") return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] =
      key === "fingerprint"
        ? "<root-derived-fingerprint>"
        : key === "assertionSiteId"
          ? "<root-derived-assertion-site-id>"
          : rootStableGoldenValue(child);
  }
  return normalized;
}

function rootRelativePath(root: string, file: string): string {
  return normalizePath(relative(root, file));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
