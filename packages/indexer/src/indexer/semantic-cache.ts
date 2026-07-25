import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  cacheFileForIdentity,
  SEMANTIC_COMPILER_OPTIONS_ID,
  SEMANTIC_FACTS_CACHE_EPOCH,
  sha256,
} from "./cache-identity";
import { compareCodepoint } from "./sort";
import { indexCacheBoundaryFileNames } from "./incremental/boundaries";
import type { IndexPatchFacts } from "./patches";
import {
  collectProjectedSemanticEvidence,
  semanticEvidenceBatchesFromFacts,
  type SemanticEvidenceBatch,
  type SemanticEvidenceBatchSource,
} from "./semantic/evidence/projection";
import { semanticIndexEvidenceBatches } from "./semantic/evidence/facts";
import {
  measureSemanticTimingAsync,
  type SemanticIndexInstrumentation,
  type SemanticIndexTimingName,
} from "./semantic/instrumentation";
import { DEFAULT_SEMANTIC_PREFLIGHT_BUDGET } from "./semantic/preflight";
import type {
  SemanticBackendIdentity,
  SemanticCompilerRuntimeIdentity,
} from "./semantic/service";
import {
  semanticSourceProfile,
  type SemanticSourceProfile,
} from "./semantic/source-profile";
import {
  createSemanticCacheValidationDependencyCollector,
  type SemanticCacheValidationDependencyCollector,
} from "./semantic/cache-validation";
import {
  readSemanticFactsCacheArtifact,
  writeSemanticFactsCacheArtifact,
} from "./semantic/cache-artifact";

type ConfigFileHash = { readonly file: string; readonly sourceHash: string };

export interface SemanticFactsProducerContext {
  /** Stable cache identity for this semantic fact set when source hashing succeeded. */
  readonly cacheIdentity?: string;
  /** Exact analysis inputs that must still match before a warm cache hit. */
  readonly validationDependencies: SemanticCacheValidationDependencyCollector;
}

export type SemanticFactsCacheMode = "read-write" | "disabled";

export interface SemanticIndexFactsCacheOptions {
  /** Local source closure already measured by semantic preflight. */
  readonly dependencyClosure?: readonly string[];
  /** Source profile already measured by semantic preflight. */
  readonly sourceProfile?: SemanticSourceProfile;
  /** Backend identity that owns the semantic facts. */
  readonly backendIdentity?: SemanticBackendIdentity;
  /** Compiler runtime identity that owns semantic project state. */
  readonly compilerRuntime?: SemanticCompilerRuntimeIdentity;
  /** Optional timing hook for semantic cache and analyzer work. */
  readonly instrumentation?: SemanticIndexInstrumentation;
  /** Durable fact-cache behavior. Defaults to `read-write`. */
  readonly cache?: SemanticFactsCacheMode;
  /** Optional backend-owned producer used when no durable semantic evidence cache is available. */
  readonly produceEvidence?: (
    context: SemanticFactsProducerContext,
  ) => SemanticEvidenceBatchSource;
}

export async function semanticIndexFactsCached(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsCacheOptions = {},
): Promise<IndexPatchFacts> {
  return collectProjectedSemanticEvidence(
    semanticIndexEvidenceBatchesCached(root, files, options),
  );
}

export async function* semanticIndexEvidenceBatchesCached(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsCacheOptions = {},
): AsyncIterable<SemanticEvidenceBatch> {
  const cacheMode = options.cache ?? "read-write";
  const sourceProfile =
    options.sourceProfile ??
    (await semanticSourceProfile(root, files, {
      dependencyClosure: options.dependencyClosure,
      maxFiles: DEFAULT_SEMANTIC_PREFLIGHT_BUDGET.maxDependencyClosureFiles,
    }));
  const cacheInput = await semanticCacheKeyInput(
    root,
    sourceProfile,
    options.backendIdentity,
    options.compilerRuntime,
  );
  const cacheIdentity = cacheInput
    ? sha256(JSON.stringify(cacheInput))
    : undefined;
  const validationDependencies =
    createSemanticCacheValidationDependencyCollector();
  const produceEvidence =
    options.produceEvidence ??
    (() =>
      semanticIndexEvidenceBatches(root, files, {
        instrumentation: options.instrumentation,
      }));

  if (cacheMode === "disabled") {
    emitSemanticCacheOutcome(
      options.instrumentation,
      "semantic.cache.disabled",
    );
    yield* produceEvidence({ cacheIdentity, validationDependencies });
    return;
  }

  if (!cacheInput) {
    emitSemanticCacheOutcome(options.instrumentation, "semantic.cache.unkeyed");
    yield* produceEvidence({ validationDependencies });
    return;
  }

  const cacheFile = cacheFileForIdentity(
    root,
    SEMANTIC_FACTS_CACHE_EPOCH,
    cacheInput,
    "bin",
  );
  const cached = await measureSemanticTimingAsync(
    options.instrumentation,
    "semantic.cache.read",
    () => readSemanticFactsCacheArtifact(cacheFile),
  );
  if (cached) {
    emitSemanticCacheOutcome(options.instrumentation, "semantic.cache.hit");
    yield* semanticEvidenceBatchesFromFacts(cached.facts);
    return;
  }
  emitSemanticCacheOutcome(options.instrumentation, "semantic.cache.miss");

  const emitted: SemanticEvidenceBatch[] = [];
  for await (const batch of produceEvidence({
    cacheIdentity,
    validationDependencies,
  })) {
    emitted.push(batch);
    yield batch;
  }
  const facts = await collectProjectedSemanticEvidence(emitted);
  if (!validationDependencies.cacheable()) return;
  await measureSemanticTimingAsync(
    options.instrumentation,
    "semantic.cache.write",
    () =>
      writeSemanticFactsCacheArtifact(cacheFile, {
        facts,
        validationDependencies: validationDependencies.values(),
      }),
  );
}

async function semanticCacheKeyInput(
  root: string,
  sourceProfile: SemanticSourceProfile,
  backendIdentity: SemanticBackendIdentity | undefined,
  compilerRuntime: SemanticCompilerRuntimeIdentity | undefined,
): Promise<
  | {
      version: string;
      backend: SemanticBackendIdentity;
      compilerRuntime: SemanticCompilerRuntimeIdentity;
      compilerOptionsVersion: string;
      root: string;
      files: Array<{ file: string; sourceHash: string }>;
      configFiles: Array<{ file: string; sourceHash: string }>;
    }
  | undefined
> {
  try {
    if (
      !sourceProfile.complete ||
      sourceProfile.files.length !== sourceProfile.dependencyClosure.length
    )
      return undefined;
    const fileInputs = sourceProfile.files
      .map((file) => ({
        file: relative(root, resolve(root, file.file)).replace(/\\/g, "/"),
        sourceHash: file.sourceHash,
      }))
      .sort(compareCacheFileInputs);

    const configFiles: ConfigFileHash[] = (
      await Promise.all(
        indexCacheBoundaryFileNames.map(
          async (name): Promise<ConfigFileHash | undefined> => {
            const file = join(root, name);
            try {
              return {
                file: name,
                sourceHash: sha256(await readFile(file, "utf8")),
              };
            } catch {
              return undefined;
            }
          },
        ),
      )
    ).filter((file): file is ConfigFileHash => Boolean(file));
    configFiles.sort(compareCacheFileInputs);

    return {
      version: SEMANTIC_FACTS_CACHE_EPOCH,
      backend: backendIdentity ?? { name: "typescript", version: "v1" },
      compilerRuntime:
        compilerRuntime ??
        defaultSemanticCompilerRuntimeIdentity(backendIdentity),
      compilerOptionsVersion: SEMANTIC_COMPILER_OPTIONS_ID,
      root,
      files: fileInputs,
      configFiles,
    };
  } catch {
    return undefined;
  }
}

function defaultSemanticCompilerRuntimeIdentity(
  backendIdentity: SemanticBackendIdentity | undefined,
): SemanticCompilerRuntimeIdentity {
  return backendIdentity
    ? { name: backendIdentity.name, version: backendIdentity.version }
    : { name: "typescript", version: "v1" };
}

function compareCacheFileInputs(
  left: ConfigFileHash,
  right: ConfigFileHash,
): number {
  return compareCodepoint(left.file, right.file);
}

function emitSemanticCacheOutcome(
  instrumentation: SemanticIndexInstrumentation | undefined,
  name: SemanticIndexTimingName,
): void {
  try {
    instrumentation?.onTiming?.({ name, durationMs: 0 });
  } catch {
    // Cache outcome counters are diagnostic-only and must not affect indexing.
  }
}
