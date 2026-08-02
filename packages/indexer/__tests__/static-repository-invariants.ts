import { dirname, isAbsolute, relative, resolve } from "node:path";
import { canonicalStaticExtractionJson } from "../src/contracts/parity";
import { staticDefinitionFileSelection } from "../src/indexer/files";
import {
  createStaticExtraction,
  type StaticFileExtraction,
} from "../src/indexer/static/extraction/engine";
import type { StaticSyntaxFrontendFactory } from "../src/indexer/static-index/syntax";

interface StaticRepositoryInvariantOptions {
  readonly syntaxFrontend: StaticSyntaxFrontendFactory;
}

export interface StaticRepositoryInvariantResult {
  readonly files: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  readonly canonicalFiles: readonly CanonicalStaticRepositoryFile[];
}

interface CanonicalStaticRepositoryFile {
  readonly file: string;
  readonly extraction: string;
}

/**
 * Runs production static discovery and extraction twice without cache reuse.
 *
 * The returned projection is stable across checkout roots and intentionally
 * remains in memory: evolving repository source is not a checked fixture.
 */
export async function assertStaticRepositoryInvariants(
  root: string,
  options: StaticRepositoryInvariantOptions,
): Promise<StaticRepositoryInvariantResult> {
  const selection = staticDefinitionFileSelection(root);
  assertDiscoveryAccounting(
    root,
    selection.files,
    selection.skipped.map((candidate) => candidate.file),
  );
  const first = await extract(root, selection.files, options.syntaxFrontend);
  const second = await extract(root, selection.files, options.syntaxFrontend);
  assertStaticRepositoryRunInvariants(root, selection.files, first);
  assertStaticRepositoryRunInvariants(root, selection.files, second);
  assertNoErrorDiagnostics(first);
  assertNoErrorDiagnostics(second);
  const firstCanonical = canonicalRun(root, first);
  const secondCanonical = canonicalRun(root, second);

  if (!equalCanonicalRuns(firstCanonical, secondCanonical)) {
    throw new Error("Static repository extraction was not deterministic");
  }

  return {
    files: selection.files.map((file) => rootRelativePath(root, file)),
    skipped: selection.skipped.map((candidate) => ({
      file: rootRelativePath(root, candidate.file),
      reason: candidate.reason,
    })),
    canonicalFiles: firstCanonical,
  };
}

function assertDiscoveryAccounting(
  root: string,
  selectedFiles: readonly string[],
  skippedFiles: readonly string[],
): void {
  const candidates = [...selectedFiles, ...skippedFiles].map((file) =>
    safeRootRelativePath(root, file),
  );
  if (new Set(candidates).size !== candidates.length) {
    throw new Error("Static repository discovery candidates must be unique");
  }
}

/** Validates file identity and exact discovery accounting for one run. */
export function assertStaticRepositoryRunInvariants(
  root: string,
  selectedFiles: readonly string[],
  extractedFiles: readonly StaticFileExtraction[],
): void {
  const selected = selectedFiles.map((file) => safeRootRelativePath(root, file));
  if (new Set(selected).size !== selected.length) {
    throw new Error("Static repository selected paths must be unique");
  }

  const extractedCounts = new Map<string, number>();
  for (const extraction of extractedFiles) {
    const file = safeRootRelativePath(root, extraction.file);
    extractedCounts.set(file, (extractedCounts.get(file) ?? 0) + 1);
  }
  const selectedSet = new Set(selected);
  const invalid = [...extractedCounts].some(
    ([file, count]) => count !== 1 || !selectedSet.has(file),
  );
  if (
    invalid ||
    extractedCounts.size !== selected.length ||
    selected.some((file) => extractedCounts.get(file) !== 1)
  ) {
    throw new Error("Every selected static repository file must be extracted exactly once");
  }

  for (const extraction of extractedFiles) {
    for (const dependency of extraction.dependencies) {
      const dependencyFile = localDependencyFile(extraction.file, dependency);
      if (!dependencyFile) continue;
      const dependencyPath = rootRelativePath(root, dependencyFile);
      if (!isSafeRelativePath(dependencyPath)) {
        throw new Error(
          `Local static repository dependency is outside the repository root: ${normalizePath(dependency)}`,
        );
      }
    }
  }
}

function localDependencyFile(file: string, dependency: string): string | undefined {
  if (isAbsolute(dependency)) return dependency;
  const normalized = normalizePath(dependency);
  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return resolve(dirname(file), dependency);
  }
  return undefined;
}

function assertNoErrorDiagnostics(files: readonly StaticFileExtraction[]): void {
  const diagnostics = files
    .flatMap((file) => file.diagnostics)
    .filter((diagnostic) => diagnostic.severity === "error");
  if (diagnostics.length === 0) return;
  throw new Error(
    `Static repository error diagnostics: ${diagnostics
      .map((diagnostic) => diagnostic.code)
      .join(", ")}`,
  );
}

async function extract(
  root: string,
  files: readonly string[],
  syntaxFrontend: StaticSyntaxFrontendFactory,
): Promise<readonly StaticFileExtraction[]> {
  return createStaticExtraction({
    root,
    cache: "none",
    syntaxFrontend,
  }).extractFiles(files, { concurrency: 8 });
}

function canonicalRun(
  root: string,
  files: readonly StaticFileExtraction[],
): readonly CanonicalStaticRepositoryFile[] {
  return files.map((file) => ({
    file: rootRelativePath(root, file.file),
    extraction: canonicalStaticExtractionJson(
      rootStableValue(
        {
          definitions: file.definitions,
          relations: file.relations,
          diagnostics: file.diagnostics,
          dependencies: file.dependencies,
        },
        root,
      ) as Parameters<typeof canonicalStaticExtractionJson>[0],
    ),
  }));
}

function equalCanonicalRuns(
  left: readonly CanonicalStaticRepositoryFile[],
  right: readonly CanonicalStaticRepositoryFile[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.file === right[index]?.file &&
        file.extraction === right[index]?.extraction,
    )
  );
}

function rootStableValue(value: unknown, root: string): unknown {
  if (typeof value === "string") return rootStableString(value, root);
  if (Array.isArray(value))
    return value.map((item) => rootStableValue(item, root));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "fingerprint"
        ? "<root-derived-fingerprint>"
        : key === "assertionSiteId"
          ? "<root-derived-assertion-site-id>"
          : rootStableValue(child, root),
    ]),
  );
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

function safeRootRelativePath(root: string, file: string): string {
  const path = rootRelativePath(root, file);
  if (!isSafeRelativePath(path)) {
    throw new Error(`Unsafe static repository path: ${normalizePath(file)}`);
  }
  return path;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path !== ".." &&
    !path.startsWith("../") &&
    !isAbsolute(path)
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
