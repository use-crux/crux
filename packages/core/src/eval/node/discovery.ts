/** Same-realm filesystem discovery and selection for authored Node Evals. */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnyEval } from "../evaluate";
import { getEvalDefinitionForInternalUse } from "../internal/definition";

export interface EvalModule {
  readonly relativeFile: string;
  readonly exports: Readonly<Record<string, unknown>>;
}

export interface DiscoveredEval {
  readonly id: string;
  readonly eval: AnyEval;
  readonly sourceKey: {
    readonly relativeFile: string;
    readonly export: "default";
  };
  readonly sidecarFile: string;
  readonly links: readonly string[];
}

export interface EvalDiscoveryError {
  readonly file: string;
  readonly message: string;
  readonly exports?: readonly string[];
}

export interface EvalDiscoveryResult {
  readonly evals: readonly DiscoveredEval[];
  readonly errors: readonly EvalDiscoveryError[];
}

/** Discover Eval modules through the caller's loader and module cache. */
export async function discoverProjectEvals(
  projectRoot: string,
): Promise<EvalDiscoveryResult> {
  const files = await findEvalFiles(projectRoot);
  const modules: EvalModule[] = [];
  const errors: EvalDiscoveryError[] = [];
  for (const relativeFile of files) {
    try {
      modules.push({
        relativeFile,
        exports: (await import(
          pathToFileURL(resolve(projectRoot, relativeFile)).href
        )) as Record<string, unknown>,
      });
    } catch (error) {
      errors.push({
        file: relativeFile,
        message: `Failed to import ${relativeFile}: ${errorMessage(error)}`,
      });
    }
  }
  const collected = collectEvalModules(modules);
  return Object.freeze({
    evals: collected.evals,
    errors: Object.freeze([...errors, ...collected.errors]),
  });
}

/** Inspect imported modules while enforcing one default Eval per source. */
export function collectEvalModules(
  modules: readonly EvalModule[],
): EvalDiscoveryResult {
  const evals: DiscoveredEval[] = [];
  const errors: EvalDiscoveryError[] = [];
  for (const module of [...modules].sort((a, b) =>
    a.relativeFile.localeCompare(b.relativeFile),
  )) {
    const relativeFile = normalizePath(module.relativeFile);
    const candidates = Object.entries(module.exports).filter(([, value]) =>
      isEval(value),
    );
    const names = candidates.map(([name]) => name);
    const defaultEval = module.exports.default;
    if (candidates.length !== 1 || !isEval(defaultEval)) {
      errors.push({
        file: relativeFile,
        exports: Object.freeze(names),
        message: discoveryExportMessage(relativeFile, names),
      });
      continue;
    }
    const definition = getEvalDefinitionForInternalUse(defaultEval);
    evals.push(
      Object.freeze({
        id: definition.explicitId ?? deriveEvalId(relativeFile),
        eval: defaultEval,
        sourceKey: Object.freeze({
          relativeFile,
          export: "default" as const,
        }),
        sidecarFile: siblingCaseFile(relativeFile),
        links: definition.covers,
      }),
    );
  }
  errors.push(...duplicateIdErrors(evals));
  return Object.freeze({
    evals: Object.freeze(errors.length === 0 ? evals : []),
    errors: Object.freeze(errors),
  });
}

/** Derive a stable simple ID from one project-relative Eval source. */
export function deriveEvalId(relativeFile: string): string {
  const normalized = normalizePath(relativeFile);
  const beneathEvals = normalized.startsWith("evals/")
    ? normalized.slice("evals/".length)
    : normalized;
  return beneathEvals.replace(/\.eval\.[cm]?[jt]sx?$/, "").replaceAll("/", ".");
}

/** Return the canonical automatic Review sidecar path. */
export function siblingCaseFile(relativeFile: string): string {
  const normalized = normalizePath(relativeFile);
  const stem = normalized.replace(/\.eval\.[cm]?[jt]sx?$/, "");
  if (stem === normalized) {
    throw new TypeError(
      `Eval source '${normalized}' must end in .eval.ts or .eval.js`,
    );
  }
  return `${stem}.cases.jsonl`;
}

type SelectableEval = Pick<DiscoveredEval, "id" | "sourceKey"> & {
  readonly links?: readonly string[];
};

/** Resolve exact IDs before paths/directories, globs, and coverage links. */
export function selectEvals<T extends SelectableEval>(
  evals: readonly T[],
  selectors: readonly string[],
): { readonly matches: readonly T[]; readonly errors: readonly string[] } {
  if (selectors.length === 0) return { matches: [...evals], errors: [] };
  const selected = new Set<T>();
  const errors: string[] = [];
  for (const selector of selectors) {
    const matches = selectOne(evals, selector);
    if (matches.length === 0) {
      errors.push(`No Eval matches '${selector}'.`);
    } else if (
      matches.length > 1 &&
      matches.every((entry) => entry.links?.includes(selector))
    ) {
      errors.push(
        `Selector '${selector}' is ambiguous. Use one exact Eval id: ${matches.map((entry) => `runEval('${entry.id}')`).join(", ")}.`,
      );
    } else {
      for (const match of matches) selected.add(match);
    }
  }
  return Object.freeze({
    matches: Object.freeze([...selected]),
    errors: Object.freeze(errors),
  });
}

function selectOne<T extends SelectableEval>(
  evals: readonly T[],
  selector: string,
): T[] {
  const exact = evals.filter((entry) => entry.id === selector);
  if (exact.length > 0) return exact;
  const normalized = normalizePath(selector)
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  const byPath = evals.filter((entry) => {
    const file = entry.sourceKey.relativeFile;
    const stem = file.replace(/\.eval\.[cm]?[jt]sx?$/, "");
    return (
      file === normalized ||
      stem === normalized ||
      file.startsWith(`${normalized}/`)
    );
  });
  if (byPath.length > 0) return byPath;
  if (selector.includes("*")) {
    const matcher = wildcardPattern(selector);
    const byGlob = evals.filter(
      (entry) =>
        matcher.test(entry.id) || matcher.test(entry.sourceKey.relativeFile),
    );
    if (byGlob.length > 0) return byGlob;
  }
  return evals.filter((entry) => entry.links?.includes(selector));
}

async function findEvalFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  await walk(root, "", files);
  return Object.freeze(files.sort());
}

async function walk(
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    if (
      ["node_modules", "dist", ".crux", ".git", ".next", ".turbo"].includes(
        entry.name,
      )
    )
      continue;
    const relativeFile = normalizePath(join(directory, entry.name));
    if (entry.isDirectory()) {
      await walk(root, relativeFile, files);
    } else if (
      (entry.isFile() ||
        (entry.isSymbolicLink() &&
          (await stat(join(root, relativeFile))).isFile())) &&
      /\.eval\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      files.push(relativeFile);
    }
  }
}

function discoveryExportMessage(
  file: string,
  names: readonly string[],
): string {
  if (names.length === 0)
    return `${file} must default-export exactly one Eval.`;
  if (names.length === 1 && names[0] !== "default") {
    return `${file} exports Eval '${names[0]}', but an Eval file must use a default export.`;
  }
  return `${file} exports Evals ${names.map((name) => `'${name}'`).join(", ")}. Keep one default Eval and split each additional Eval into its own file.`;
}

function duplicateIdErrors(
  evals: readonly DiscoveredEval[],
): EvalDiscoveryError[] {
  const byId = new Map<string, DiscoveredEval[]>();
  for (const entry of evals)
    byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  return [...byId]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({
      file: entries[0]!.sourceKey.relativeFile,
      message: `Duplicate Eval id '${id}' in ${entries.map((entry) => entry.sourceKey.relativeFile).join(", ")}. Add a unique explicit id or rename a source file.`,
    }));
}

function isEval(value: unknown): value is AnyEval {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxEval"
  );
}

function wildcardPattern(value: string): RegExp {
  const escaped = value
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
