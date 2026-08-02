import type { ProjectDefinitionKind } from "@use-crux/core/project-index";
import type {
  NativeDirectDependencySpec,
  NativeDirectIdentifierDependencySpec,
  NativeDirectPrimitiveSpec,
} from "./manifest";
import { objectDependencyTargetKinds } from "./manifest";

/** Syntax shapes recognized by the cache-bypassing completion compiler. */
export type CompletionSlot =
  | "scalarIdentifier"
  | "identifierArrayElement"
  | "toolMapMember"
  | "staticId"
  | "routingTarget";

/** Edit recipes emitted after a candidate passes syntax and kind checks. */
export type CompletionInsertion = "identifier" | "toolMapMember" | "staticId";

/** One data-only first-party slot consumed by the transient completion query. */
export interface CompletionSiteManifestEntry {
  readonly callNames: readonly string[];
  /**
   * Path from the call's config object to the authored slot.
   *
   * `*` is one array/object member and `$args` enters direct call arguments.
   */
  readonly propertyPath: readonly string[];
  readonly slot: CompletionSlot;
  readonly acceptedKinds: readonly ProjectDefinitionKind[];
  readonly insertion: CompletionInsertion;
  /** Excludes the definition containing the active slot. */
  readonly excludeSelf?: true;
}

const routingOwnerKinds = [
  "routing.router",
  "routing.split",
  "routing.retry",
  "routing.cascade",
  "routing.fallback",
] as const satisfies readonly ProjectDefinitionKind[];

const routingTargetKinds = [
  ...routingOwnerKinds,
  "agent",
  "prompt",
] as const satisfies readonly ProjectDefinitionKind[];

/**
 * Specialized routing projectors emit these authored target roles.
 *
 * Keeping the syntax paths beside normalization makes their exceptional
 * call-argument and nested-map shapes explicit without teaching Go or the LSP
 * routing semantics.
 */
const routingCompletionSites = [
  routingSite("router", ["routes", "*"]),
  routingSite("router", ["routes", "*", "model"]),
  routingSite("split", ["routes", "*", "model"]),
  routingSite("retry", ["$args", "0"]),
  routingSite("cascade", ["tiers", "*", "model"]),
  routingSite("fallback", ["$args", "0", "*"]),
  routingSite("fallback", ["$args", "*"]),
] as const satisfies readonly CompletionSiteManifestEntry[];

/**
 * Normalizes every compiler-declared first-party dependency shape.
 *
 * The dependency discriminant is the completeness boundary: adding an emitted
 * dependency shape requires handling it here or the exhaustive switch fails.
 * Unsupported MCP allowlist output is deliberately not an authored reference.
 */
export function completionSiteManifest(
  primitives: readonly NativeDirectPrimitiveSpec[],
): readonly CompletionSiteManifestEntry[] {
  const dependencySites = primitives.flatMap((primitive) =>
    primitive.dependencies.flatMap((dependency) =>
      completionSitesForDependency(primitive.callName, dependency),
    ),
  );
  return mergeEquivalentSites([...routingCompletionSites, ...dependencySites]);
}

function completionSitesForDependency(
  callName: string,
  dependency: NativeDirectDependencySpec,
): readonly CompletionSiteManifestEntry[] {
  if (dependency.kind === "mcpExpectedTools") return [];
  switch (dependency.kind) {
    case "identifierProperty":
      return [
        site(
          callName,
          [dependency.property],
          "scalarIdentifier",
          identifierTargetKinds(dependency),
          "identifier",
        ),
      ];
    case "arrayIdentifier":
      return [
        site(
          callName,
          [dependency.property, "*"],
          "identifierArrayElement",
          [dependency.targetKind],
          "identifier",
        ),
      ];
    case "objectShorthand":
      return [
        site(
          callName,
          [dependency.property, "*"],
          "toolMapMember",
          objectDependencyTargetKinds(dependency),
          "toolMapMember",
        ),
      ];
    case "staticIdArray":
      return [
        staticIdSite(
          callName,
          [dependency.property, "*"],
          dependency.targetKind,
        ),
        staticIdSite(
          callName,
          [dependency.property, "*", "id"],
          dependency.targetKind,
        ),
      ];
    default:
      return assertNever(dependency);
  }
}

function site(
  callName: string,
  propertyPath: readonly string[],
  slot: CompletionSlot,
  acceptedKinds: readonly ProjectDefinitionKind[],
  insertion: CompletionInsertion,
): CompletionSiteManifestEntry {
  return {
    callNames: [callName],
    propertyPath,
    slot,
    acceptedKinds,
    insertion,
  };
}

function staticIdSite(
  callName: string,
  propertyPath: readonly string[],
  targetKind: ProjectDefinitionKind,
): CompletionSiteManifestEntry {
  return {
    ...site(callName, propertyPath, "staticId", [targetKind], "staticId"),
    excludeSelf: true,
  };
}

function routingSite(
  callName: "cascade" | "fallback" | "retry" | "router" | "split",
  propertyPath: readonly string[],
): CompletionSiteManifestEntry {
  return {
    ...site(
      callName,
      propertyPath,
      "routingTarget",
      routingTargetKinds,
      "identifier",
    ),
    excludeSelf: true,
  };
}

function identifierTargetKinds(
  dependency: NativeDirectIdentifierDependencySpec,
): readonly ProjectDefinitionKind[] {
  return dependency.targetKinds ?? [dependency.targetKind];
}

function mergeEquivalentSites(
  entries: readonly CompletionSiteManifestEntry[],
): readonly CompletionSiteManifestEntry[] {
  const merged = new Map<string, CompletionSiteManifestEntry>();
  for (const entry of entries) {
    const key = JSON.stringify({
      callNames: entry.callNames,
      propertyPath: entry.propertyPath,
      slot: entry.slot,
      insertion: entry.insertion,
      excludeSelf: entry.excludeSelf,
    });
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, entry);
      continue;
    }
    merged.set(key, {
      ...previous,
      acceptedKinds: [
        ...new Set([...previous.acceptedKinds, ...entry.acceptedKinds]),
      ],
    });
  }
  return [...merged.values()];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled completion dependency: ${String(value)}`);
}
