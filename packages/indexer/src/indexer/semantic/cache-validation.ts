import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { sha256 } from "../cache-identity";
import { compareCodepoint } from "../sort";

/** One exact file whose bytes must still match before a semantic cache hit. */
export interface SemanticCacheValidationDependency {
  readonly file: string;
  readonly digest: string;
}

/** Analysis-scoped collector for semantic cache validation dependencies. */
export interface SemanticCacheValidationDependencyCollector {
  /** Record one exact absolute file path and SHA-256 digest. */
  record(dependency: SemanticCacheValidationDependency): void;
  /** Prevent a fact set with unrecordable validation evidence from being cached. */
  invalidate(): void;
  /** Return whether every required validation input was recordable. */
  cacheable(): boolean;
  /** Return deterministic validation dependencies collected so far. */
  values(): readonly SemanticCacheValidationDependency[];
}

/** Creates a deterministic analysis-scoped validation dependency collector. */
export function createSemanticCacheValidationDependencyCollector(): SemanticCacheValidationDependencyCollector {
  const dependencies = new Map<string, string>();
  let cacheable = true;
  return {
    record(dependency) {
      if (!isSemanticCacheValidationDependency(dependency)) return;
      dependencies.set(dependency.file, dependency.digest);
    },
    invalidate() {
      cacheable = false;
    },
    cacheable() {
      return cacheable;
    },
    values() {
      return [...dependencies]
        .sort(([left], [right]) => compareCodepoint(left, right))
        .map(([file, digest]) => ({ file, digest }));
    },
  };
}

/** Revalidates only the exact dependency paths recorded in a cache artifact. */
export async function validateSemanticCacheDependencies(
  dependencies: readonly SemanticCacheValidationDependency[],
): Promise<boolean> {
  try {
    for (const dependency of dependencies) {
      const source = await readFile(dependency.file);
      if (sha256(source) !== dependency.digest) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns whether an unknown value is one valid cache dependency row. */
export function isSemanticCacheValidationDependency(
  value: unknown,
): value is SemanticCacheValidationDependency {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.file === "string" &&
    isAbsolute(candidate.file) &&
    typeof candidate.digest === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.digest)
  );
}
