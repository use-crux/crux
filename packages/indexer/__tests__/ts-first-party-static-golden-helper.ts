import { createHash } from "node:crypto";
import { relative } from "node:path";
import { canonicalStaticExtractionJson } from "../contracts/parity";
import {
  createStaticExtraction,
  createTypeScriptStaticSyntaxFrontend,
  staticDefinitionFiles,
  type StaticFileExtraction,
  type StaticSyntaxFrontendFactory,
} from "../host/static-index";
import type {
  TsFirstPartyStaticGoldenFileFixture,
  TsFirstPartyStaticGoldenSharedFixture,
  TsFirstPartyStaticGoldenTotalsFixture,
} from "../contracts/fixtures";

interface StaticExtractionProjection {
  readonly definitions: StaticFileExtraction["definitions"];
  readonly relations: StaticFileExtraction["relations"];
  readonly diagnostics: StaticFileExtraction["diagnostics"];
  readonly dependencies: StaticFileExtraction["dependencies"];
}

type FirstPartyStaticGoldenFrontend = "typescript" | "oxc-rust";

type FirstPartyStaticGoldenSnapshot<
  Frontend extends FirstPartyStaticGoldenFrontend,
> = Omit<TsFirstPartyStaticGoldenSharedFixture, "frontend"> & {
  readonly frontend: Frontend;
};

interface FirstPartyStaticGoldenOptions<
  Frontend extends FirstPartyStaticGoldenFrontend,
> {
  readonly frontend: Frontend;
  readonly syntaxFrontend: StaticSyntaxFrontendFactory;
}

/**
 * Regenerates a compact first-party static golden with the requested syntax frontend.
 *
 * The P5 Rust-default cutover needs a stable TypeScript reference snapshot for
 * first-party static output. This helper records
 * root-independent canonical hashes rather than duplicating the full fact
 * payload, so later Rust-oracle checks can detect exact drift without checking
 * in megabytes of generated JSON.
 */
export async function generateFirstPartyStaticGolden<
  Frontend extends FirstPartyStaticGoldenFrontend,
>(
  root: string,
  options: FirstPartyStaticGoldenOptions<Frontend>,
): Promise<FirstPartyStaticGoldenSnapshot<Frontend>> {
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
    frontend: options.frontend,
    rootPlaceholder: "<repo>",
    fileSelection: "staticDefinitionFiles(root)",
    projection:
      "canonicalStaticExtractionJson(definitions,relations,diagnostics,dependencies)",
    totals: totalsFromFiles(entries),
    files: entries,
  };
}

/** Regenerates the TypeScript first-party static reference golden. */
export async function generateTsFirstPartyStaticGolden(
  root: string,
): Promise<TsFirstPartyStaticGoldenSharedFixture> {
  return generateFirstPartyStaticGolden(root, {
    frontend: "typescript",
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  });
}

function goldenFile(
  root: string,
  extracted: StaticFileExtraction,
): TsFirstPartyStaticGoldenFileFixture {
  const facts = rootStableValue(projectStaticExtraction(extracted), root);
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
  files: readonly TsFirstPartyStaticGoldenFileFixture[],
): TsFirstPartyStaticGoldenTotalsFixture {
  return files.reduce<TsFirstPartyStaticGoldenTotalsFixture>(
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

function rootRelativePath(root: string, file: string): string {
  return normalizePath(relative(root, file));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
