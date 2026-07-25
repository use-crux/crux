import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { IndexPatchFacts } from "../patches";
import {
  isSemanticCacheValidationDependency,
  validateSemanticCacheDependencies,
  type SemanticCacheValidationDependency,
} from "./cache-validation";

const semanticFactsBinaryCacheMagic = Buffer.from(
  "crux.semantic.facts.v2\n",
  "utf8",
);

export interface SemanticFactsCacheArtifact {
  readonly facts: IndexPatchFacts;
  readonly validationDependencies: readonly SemanticCacheValidationDependency[];
}

/** Reads and validates one binary semantic-facts cache artifact. */
export async function readSemanticFactsCacheArtifact(
  file: string,
): Promise<SemanticFactsCacheArtifact | undefined> {
  try {
    const encoded = await readFile(file);
    if (
      !encoded
        .subarray(0, semanticFactsBinaryCacheMagic.length)
        .equals(semanticFactsBinaryCacheMagic)
    ) {
      return undefined;
    }
    const parsed = deserialize(
      encoded.subarray(semanticFactsBinaryCacheMagic.length),
    ) as unknown;
    if (!isSemanticFactsCacheArtifact(parsed)) return undefined;
    return (await validateSemanticCacheDependencies(
      parsed.validationDependencies,
    ))
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort binary write for one semantic-facts cache artifact. */
export async function writeSemanticFactsCacheArtifact(
  file: string,
  artifact: SemanticFactsCacheArtifact,
): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      Buffer.concat([semanticFactsBinaryCacheMagic, serialize(artifact)]),
    );
  } catch {
    // Semantic cache writes are best effort. Index indexing must never fail
    // because local cache storage is unavailable or read-only.
  }
}

function isSemanticFactsCacheArtifact(
  value: unknown,
): value is SemanticFactsCacheArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isIndexPatchFacts(candidate.facts) &&
    Array.isArray(candidate.validationDependencies) &&
    candidate.validationDependencies.every(isSemanticCacheValidationDependency)
  );
}

function isIndexPatchFacts(value: unknown): value is IndexPatchFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    arrayOrMissing(candidate.definitions) &&
    arrayOrMissing(candidate.relations) &&
    arrayOrMissing(candidate.sourceRefs) &&
    arrayOrMissing(candidate.diagnostics) &&
    arrayOrMissing(candidate.lintFindings) &&
    arrayOrMissing(candidate.sources)
  );
}

function arrayOrMissing(value: unknown): boolean {
  return value === undefined || Array.isArray(value);
}
