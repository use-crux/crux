/** Node module resolution rules for portable Eval source identity. */

import { readFile, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolveImport } from "import-meta-resolve";
import { maskNonCode } from "./source-task-identity";

const SOURCE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
] as const;

export type ResolvedSourceDependency =
  | { readonly kind: "source"; readonly path: string }
  | { readonly kind: "external"; readonly identity: string }
  | { readonly kind: "unresolved" };

export async function resolveSourceDependency(
  importer: string,
  specifier: string,
): Promise<ResolvedSourceDependency> {
  let resolvedPath: string | undefined;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    resolvedPath = await resolveSourcePath(
      resolve(dirname(importer), specifier),
    );
  } else {
    try {
      const resolved = resolveImport(specifier, pathToFileURL(importer).href);
      if (!resolved.startsWith("file:")) return { kind: "unresolved" };
      resolvedPath = fileURLToPath(resolved);
    } catch {
      return { kind: "unresolved" };
    }
  }
  if (resolvedPath === undefined) return { kind: "unresolved" };
  let canonical: string;
  try {
    canonical = await realpath(resolvedPath);
  } catch {
    return { kind: "unresolved" };
  }
  if (hasNodeModulesSegment(resolvedPath) && hasNodeModulesSegment(canonical)) {
    const identity = await externalPackageIdentity(canonical, specifier);
    return identity === undefined
      ? { kind: "unresolved" }
      : { kind: "external", identity };
  }
  return { kind: "source", path: canonical };
}

export async function portableSourceId(
  projectRoot: string,
  path: string,
): Promise<string | undefined> {
  if (isWithin(projectRoot, path)) {
    return `project:${normalizeSourcePath(relative(projectRoot, path))}`;
  }
  let directory = dirname(path);
  while (true) {
    try {
      const parsed = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as { readonly name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.length > 0) {
        return `workspace:${parsed.name}:${normalizeSourcePath(relative(directory, path))}`;
      }
    } catch {
      // Continue to the parent package boundary.
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function isUnsupportedEvalSource(path: string, source: string): boolean {
  if (/\.(?:cjs|cts|d\.ts)$/u.test(path)) return true;
  if (
    /\b(?:require\s*\(|module\.exports\b|exports\s*\.)/u.test(
      maskNonCode(source),
    )
  ) {
    return true;
  }
  return /(?:@generated|generated file|do not edit)/iu.test(
    source.split(/\r?\n/u).slice(0, 5).join("\n"),
  );
}

export function normalizeSourcePath(path: string): string {
  return path.split(sep).join("/");
}

async function resolveSourcePath(base: string): Promise<string | undefined> {
  const extension = extname(base);
  const candidates = extension
    ? [base, ...typescriptAlternates(base, extension)]
    : SOURCE_EXTENSIONS.flatMap((suffix) => [
        `${base}${suffix}`,
        join(base, `index${suffix}`),
      ]);
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next deterministic source form.
    }
  }
  return undefined;
}

function typescriptAlternates(base: string, extension: string): string[] {
  if (![".js", ".jsx", ".mjs"].includes(extension)) return [];
  const stem = base.slice(0, -extension.length);
  return extension === ".mjs"
    ? [`${stem}.mts`, `${stem}.ts`]
    : [`${stem}.ts`, `${stem}.tsx`];
}

async function externalPackageIdentity(
  path: string,
  specifier: string,
): Promise<string | undefined> {
  let directory = dirname(path);
  while (hasNodeModulesSegment(directory)) {
    try {
      const parsed = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as { readonly name?: unknown; readonly version?: unknown };
      if (
        typeof parsed.name === "string" &&
        parsed.name.length > 0 &&
        typeof parsed.version === "string" &&
        parsed.version.length > 0
      ) {
        return `external:${parsed.name}@${parsed.version}:${specifier}:${normalizeSourcePath(relative(directory, path))}`;
      }
    } catch {
      // Continue to the installed package boundary.
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
}

function hasNodeModulesSegment(path: string): boolean {
  return path.split(sep).includes("node_modules");
}

function isWithin(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}
