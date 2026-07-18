import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type {
  RuntimeArtifactManifest,
  RuntimeArtifactManifestTarget,
} from "@use-crux/core/runtime";
import { createRuntimeError } from "@use-crux/core/runtime";
import type { RuntimeArtifactDriftReport } from "./types";

/** Project runtime definitions into the v1 runtime artifact manifest. */
export function manifestFromDefinitions(input: {
  readonly root: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly evalPrivacyFingerprint?: string;
}): RuntimeArtifactManifest {
  const targets = input.definitions.flatMap((definition) =>
    targetFromDefinition(input.root, definition),
  );
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.name)) throw duplicateTargetError(target.name);
    seen.add(target.name);
  }
  return {
    version: 1,
    evalPrivacyFingerprint:
      input.evalPrivacyFingerprint ??
      "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
    targets: [...targets].sort(
      (a, b) =>
        compareCodepoint(a.name, b.name) || compareCodepoint(a.kind, b.kind),
    ),
    evals: [],
  };
}

/** Compare manifest target names with target ids found in non-terminal runtime store rows. */
export function diffRuntimeArtifactDrift(input: {
  readonly manifest: RuntimeArtifactManifest;
  readonly nonTerminalTargetIds: readonly string[];
}): RuntimeArtifactDriftReport {
  const manifestNames = new Set(
    input.manifest.targets.map((target) => target.name),
  );
  const counts = new Map<string, number>();
  for (const targetId of input.nonTerminalTargetIds) {
    if (manifestNames.has(targetId)) continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  return {
    missingTargets: [...counts]
      .map(([targetId, count]) => ({ targetId, count }))
      .sort((a, b) => compareCodepoint(a.targetId, b.targetId)),
  };
}

function targetFromDefinition(
  root: string,
  definition: ProjectDefinition,
): readonly RuntimeArtifactManifestTarget[] {
  if (definition.kind !== "flow" && definition.kind !== "task") return [];
  const exportName =
    typeof definition.metadata?.exportName === "string"
      ? definition.metadata.exportName
      : undefined;
  const file = definition.source?.file;
  if (!exportName || !file) return [];
  return [
    {
      name: definition.name,
      kind: definition.kind,
      module: `./${relative(root, file).replace(/\\/g, "/")}`,
      export: exportName,
    },
  ];
}

function duplicateTargetError(name: string): never {
  throw createRuntimeError({
    code: "TARGET_DUPLICATE",
    whatFailed: `Runtime target \`${name}\` is discovered more than once.`,
    why: "Generated runtime artifacts need one stable target for each durable name.",
    whatStillWorks:
      "Other uniquely named runtime targets can still be discovered.",
    nextStep:
      "Rename one target or remove the duplicate export, then run `crux runtime generate` again.",
  });
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
