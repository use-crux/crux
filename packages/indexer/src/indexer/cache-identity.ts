import { createHash } from "node:crypto";
import { join } from "node:path";
import type { IndexDependency } from "./extensions";
import type { ProjectIndexCompilerProfile } from "./compiler/profile";

/**
 * Cache epochs are intentional invalidation levers for compiler behavior that is not captured by
 * source/config hashes or structured dependency identities.
 */
export const STATIC_PARSE_CACHE_EPOCH = "static-parse-v92";
/**
 * Semantic v48 adds Session diagnostic classification and owner-mutation findings.
 * Signal provider/transport binding facts are static-only in this vertical; no
 * semantic epoch bump is required until shared semantic enrichment is added.
 */
export const SEMANTIC_FACTS_CACHE_EPOCH = "semantic-facts-v48";
export const SEMANTIC_COMPILER_OPTIONS_ID =
  "ts-bundler-es2022-strict-false-types-empty";

export function cacheFileForIdentity(
  root: string,
  epoch: string,
  identity: unknown,
  extension = "json",
): string {
  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  return join(
    root,
    ".crux",
    "cache",
    "index",
    epoch,
    `${sha256(JSON.stringify(identity))}${suffix}`,
  );
}

export function compilerProfileCacheInputs(
  profile: ProjectIndexCompilerProfile,
): readonly IndexDependency[] {
  return [
    { kind: "compiler-profile", name: profile.name, version: profile.version },
    ...(profile.projections ?? []).map((projection) => ({
      kind: "compiler-projection" as const,
      name: projection.name,
      version: projection.version,
      phase: projection.phase,
    })),
  ];
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
