import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type {
  RuntimeArtifactManifest,
  RuntimeArtifactManifestEffectTarget,
  RuntimeArtifactManifestTarget,
} from "@use-crux/core/runtime";
import { RuntimeArtifactGenerationError } from "./findings";
import type { RuntimeArtifactDriftReport } from "./types";
import type { RuntimeArtifactFinding } from "./types";

/** Project runtime definitions into the v2 runtime artifact manifest. */
export function manifestFromDefinitions(input: {
  readonly root: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly evalPrivacyFingerprint?: string;
}): RuntimeArtifactManifest {
  const plan = manifestPlanFromDefinitions(input);
  if (plan.findings.length > 0) {
    throw new RuntimeArtifactGenerationError(plan.findings);
  }
  return plan.manifest;
}

/** Build a target manifest while retaining validation findings for aggregation. */
export function manifestPlanFromDefinitions(input: {
  readonly root: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly evalPrivacyFingerprint?: string;
}): {
  readonly manifest: RuntimeArtifactManifest;
  readonly findings: readonly RuntimeArtifactFinding[];
} {
  const targets = input.definitions.flatMap((definition) =>
    targetFromDefinition(input.root, definition),
  );
  const effectTargets = input.definitions.flatMap((definition) =>
    effectTargetFromDefinition(input.root, definition),
  );
  const byName = new Map<string, RuntimeArtifactManifestTarget[]>();
  for (const target of targets) {
    const matching = byName.get(target.name) ?? [];
    matching.push(target);
    byName.set(target.name, matching);
  }
  const duplicateFindings = [...byName]
    .filter((entry) => entry[1].length > 1)
    .map(([name, matching]) => duplicateTargetFinding(name, matching));
  return Object.freeze({
    manifest: Object.freeze({
      version: 3,
      evalPrivacyFingerprint:
        input.evalPrivacyFingerprint ??
        "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
      targets: Object.freeze(
        [...targets].sort(
          (a, b) =>
            compareCodepoint(a.name, b.name) ||
            compareCodepoint(a.kind, b.kind),
        ),
      ),
      effectTargets: Object.freeze(
        [...effectTargets].sort(
          (a, b) =>
            compareCodepoint(a.id, b.id) ||
            a.version - b.version ||
            compareCodepoint(a.module, b.module) ||
            compareCodepoint(a.export, b.export),
        ),
      ),
      evals: Object.freeze([]),
    }),
    findings: Object.freeze(duplicateFindings),
  });
}

function effectTargetFromDefinition(
  root: string,
  definition: ProjectDefinition,
): readonly RuntimeArtifactManifestEffectTarget[] {
  if (definition.kind !== "effect") return [];
  const metadata = definition.metadata;
  const facts = isRecord(metadata?.facts) ? metadata.facts : undefined;
  const id = typeof facts?.effectId === "string" ? facts.effectId : undefined;
  const version =
    typeof facts?.version === "number" && Number.isFinite(facts.version)
      ? facts.version
      : undefined;
  const recoverable = facts?.recoverable === true;
  const exported = metadata?.exported === true;
  const exportName =
    typeof metadata?.exportName === "string"
      ? metadata.exportName
      : undefined;
  const file = definition.source?.file;
  if (
    !recoverable ||
    !exported ||
    !id ||
    version === undefined ||
    !exportName ||
    !file
  ) {
    return [];
  }
  return [
    {
      id,
      version,
      module: `./${relative(root, file).replace(/\\/g, "/")}`,
      export: exportName,
    },
  ];
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

function duplicateTargetFinding(
  name: string,
  targets: readonly RuntimeArtifactManifestTarget[],
): RuntimeArtifactFinding {
  return {
    code: "TARGET_DUPLICATE",
    category: "authored",
    featureKind: "target",
    featureId: name,
    source: targets[0]?.module.replace(/^\.\//, ""),
    summary: `Runtime target '${name}' is declared more than once.`,
    reason: `Crux found ${targets.length} definitions with that durable name and cannot choose between them.`,
    whatStillWorks:
      "Other uniquely named runtime targets can still be discovered.",
    remediation: "Rename one target or remove the duplicate definition.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
