import type {
  IndexDependency,
  IndexerExtensionRuntime,
} from "../../extensions";
import {
  compilerProfileCacheInputs,
  type ProjectIndexCompilerProfile,
} from "../../compiler/profile";
import { runtimeManifestCacheInputs } from "../../extensions/runtime/manifest-cache-inputs";
import { compareCodepoint } from "../../sort";
import type {
  NativeFactProjectionMode,
  StaticSyntaxFrontendIdentity,
} from "../../static-index/syntax/record";

/**
 * Structural identity for one static extraction engine.
 *
 * Cache identity is not a version string. It is a projection of every compiler input that can change
 * static output without changing the source file itself: extension manifests, extractor identities,
 * rule identities, compiler profile/projection identities, and the syntax frontend version.
 */
export interface StaticExtractionIdentity {
  /** Syntax frontend selected for this extraction run. */
  readonly syntaxFrontend: StaticSyntaxFrontendIdentity;
  /** Stable, JSON-serializable dependencies that participate in static cache keys. */
  readonly cacheInputs: readonly IndexDependency[];
  /** Source-local call names the parser should consider during call-site discovery. */
  readonly callNames: ReadonlySet<string>;
}

/**
 * Computes deterministic cache and parser identity from a compiler profile plus extension runtime.
 */
export function staticExtractionIdentity(input: {
  readonly profile: ProjectIndexCompilerProfile;
  readonly extensionRuntime: IndexerExtensionRuntime;
  readonly syntaxFrontend: StaticSyntaxFrontendIdentity;
  readonly nativeFactProjection?: NativeFactProjectionMode;
  readonly additionalCacheInputs?: readonly IndexDependency[];
}): StaticExtractionIdentity {
  const cacheInputs = stableDependencies([
    ...input.extensionRuntime.manifest.cacheInputs,
    ...runtimeManifestCacheInputs(input.extensionRuntime.manifest),
    ...(input.additionalCacheInputs ?? []),
    ...compilerProfileCacheInputs(input.profile),
    syntaxFrontendIdentity(input.syntaxFrontend),
    ...nativeFactProjectionIdentity(input.nativeFactProjection),
  ]);
  const callNames = new Set([
    ...input.extensionRuntime.manifest.callNames,
    ...(input.profile.projections ?? []).flatMap(
      (projection) => projection.staticCallNames ?? [],
    ),
  ]);
  return Object.freeze({
    syntaxFrontend: input.syntaxFrontend,
    cacheInputs,
    callNames,
  });
}

export interface StaticExtensionPackageCacheInput {
  readonly packageName: string;
  readonly exportName?: string;
  readonly packageVersion?: string;
}

/** Captures installed extension package versions that are not part of the extension manifest. */
export function staticExtensionPackageCacheInputs(
  extensions: readonly StaticExtensionPackageCacheInput[],
): readonly IndexDependency[] {
  return extensions.flatMap((extension) =>
    extension.packageVersion
      ? [
          {
            kind: "extension",
            name: `package:${extension.packageName}#${extension.exportName ?? "default"}`,
            version: extension.packageVersion,
          },
        ]
      : [],
  );
}

/** Captures the selected syntax frontend as an explicit cache dependency. */
function syntaxFrontendIdentity(
  frontend: StaticSyntaxFrontendIdentity,
): IndexDependency {
  return {
    kind: "syntax-frontend",
    name: frontend.name,
    version: frontend.version,
  };
}

/** Captures non-default native fact projection lanes in cache identity. */
function nativeFactProjectionIdentity(
  mode: NativeFactProjectionMode | undefined,
): readonly IndexDependency[] {
  if (!mode || mode === "inline") return [];
  return [
    {
      kind: "compiler-projection",
      name: "native-fact-projection",
      version: mode,
      phase: "static",
    },
  ];
}

/**
 * Canonicalizes dependency order.
 *
 * Two engines with the same semantic configuration should produce byte-identical cache inputs even
 * when manifests were authored in a different order.
 */
function stableDependencies(
  dependencies: readonly IndexDependency[],
): readonly IndexDependency[] {
  const byKey = new Map<string, IndexDependency>();
  for (const dependency of dependencies) {
    byKey.set(JSON.stringify(dependency), dependency);
  }
  return Object.freeze(
    [...byKey.entries()]
      .sort(([left], [right]) => compareCodepoint(left, right))
      .map(([, value]) => value),
  );
}
