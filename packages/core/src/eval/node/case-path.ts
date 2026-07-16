/** Node realpath-safe authored Case-file resolution relative to an Eval source. */

import { realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
} from "node:path";

export class EvalCaseFileError extends Error {
  override readonly name = "EvalCaseFileError";

  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`Eval Case file ${path}: ${detail}`);
  }
}

export interface ResolveAuthoredCaseFileOptions {
  readonly projectRoot: string;
  readonly sourceFile: string;
  readonly sidecarFile: string;
  readonly authoredPath: string;
  readonly registerWatchDependency?: (canonicalPath: string) => void;
}

/** Resolve an authored Case file and return its canonical project identity. */
export async function resolveAuthoredCaseFile(
  options: ResolveAuthoredCaseFileOptions,
): Promise<{
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly exists: true;
}> {
  if (
    isAbsolute(options.authoredPath) ||
    win32.isAbsolute(options.authoredPath)
  ) {
    throw pathError(
      options,
      undefined,
      "absolute paths are not allowed; use a relative path from the Eval file",
    );
  }
  const root = await realpath(options.projectRoot).catch((error: unknown) => {
    throw pathError(
      options,
      undefined,
      `cannot realpath the configured project root (${errorMessage(error)})`,
    );
  });
  const source = resolve(root, options.sourceFile);
  assertContained(
    root,
    source,
    options,
    undefined,
    "the Eval source is outside the project root",
  );
  const lexicalTarget = resolve(dirname(source), options.authoredPath);
  const lexicalCanonical = projectRelative(root, lexicalTarget);
  assertContained(
    root,
    lexicalTarget,
    options,
    lexicalCanonical,
    "the authored path resolves outside the project root",
  );
  const target = await realpathOrNearest(lexicalTarget).catch(
    (error: unknown) => {
      throw pathError(
        options,
        lexicalCanonical,
        `cannot resolve the target (${errorMessage(error)})`,
      );
    },
  );
  assertContained(
    root,
    target.path,
    options,
    projectRelative(root, target.path),
    "the real target resolves outside the project root",
  );
  const canonicalPath = projectRelative(root, target.path);
  options.registerWatchDependency?.(canonicalPath);
  const sidecar = await realpathOrNearest(resolve(root, options.sidecarFile));
  if (target.path === sidecar.path) {
    throw pathError(
      options,
      canonicalPath,
      "This Eval's sibling .cases.jsonl file is loaded automatically. Remove the caseFile() entry or point it at a different hand-authored Case file.",
    );
  }
  if (!target.exists) {
    throw pathError(
      options,
      canonicalPath,
      "file does not exist; resolution was relative to the declaring Eval directory. Create the file there or correct the caseFile() path",
    );
  }
  const info = await stat(target.path);
  if (!info.isFile()) {
    throw pathError(
      options,
      canonicalPath,
      "target must be a regular Case file",
    );
  }
  if (![".json", ".jsonl", ".csv"].includes(extname(canonicalPath))) {
    throw pathError(
      options,
      canonicalPath,
      "supported Case-file extensions are .json, .jsonl, and .csv",
    );
  }
  return Object.freeze({
    absolutePath: target.path,
    canonicalPath,
    exists: true as const,
  });
}

async function realpathOrNearest(
  absolutePath: string,
): Promise<{ readonly path: string; readonly exists: boolean }> {
  try {
    return { path: await realpath(absolutePath), exists: true };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const suffix: string[] = [];
  let cursor = absolutePath;
  for (;;) {
    try {
      return { path: join(await realpath(cursor), ...suffix), exists: false };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor)
      throw new Error(`No existing ancestor for ${absolutePath}`);
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
}

function assertContained(
  root: string,
  target: string,
  options: ResolveAuthoredCaseFileOptions,
  canonicalPath: string | undefined,
  detail: string,
): void {
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith("../") ||
    fromRoot.startsWith("..\\") ||
    isAbsolute(fromRoot)
  ) {
    throw pathError(options, canonicalPath, detail);
  }
}

function projectRelative(root: string, target: string): string {
  return relative(root, target).replaceAll("\\", "/");
}

function pathError(
  options: ResolveAuthoredCaseFileOptions,
  canonicalPath: string | undefined,
  detail: string,
): EvalCaseFileError {
  const attempted =
    canonicalPath === undefined ? "" : `; canonical target '${canonicalPath}'`;
  return new EvalCaseFileError(
    options.sourceFile,
    `caseFile('${options.authoredPath}')${attempted}: ${detail}`,
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
