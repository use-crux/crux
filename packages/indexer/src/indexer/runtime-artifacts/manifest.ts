import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type {
  RuntimeArtifactManifest,
  RuntimeArtifactManifestEffectTarget,
  RuntimeArtifactManifestProvider,
  RuntimeArtifactManifestTarget,
  RuntimeArtifactManifestTransport,
} from "@use-crux/core/runtime";
import { RuntimeArtifactGenerationError } from "./findings";
import type { RuntimeArtifactDriftReport } from "./types";
import type { RuntimeArtifactFinding } from "./types";

/** Project runtime definitions into the v3 runtime artifact manifest. */
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
  const providers = input.definitions.flatMap((definition) =>
    providerFromDefinition(input.root, definition),
  );
  const transports = input.definitions.flatMap((definition) =>
    transportFromDefinition(input.root, definition),
  );
  const byName = new Map<string, RuntimeArtifactManifestTarget[]>();
  for (const target of targets) {
    const matching = byName.get(target.name) ?? [];
    matching.push(target);
    byName.set(target.name, matching);
  }
  const findings = [
    ...[...byName]
      .filter((entry) => entry[1].length > 1)
      .map(([name, matching]) => duplicateTargetFinding(name, matching)),
    ...duplicateIdentityFindings(
      "provider",
      providers.map((provider) => ({
        id: provider.id,
        module: provider.module,
      })),
    ),
    ...duplicateIdentityFindings(
      "transport",
      transports.map((transport) => ({
        id: transport.id,
        module: transport.module,
      })),
    ),
    ...missingProviderFindings(providers, transports),
  ];
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
            providers: Object.freeze(
        [...providers].sort((a, b) => compareCodepoint(a.id, b.id)),
      ),
      transports: Object.freeze(
        [...transports].sort((a, b) => compareCodepoint(a.id, b.id)),
      ),
      evals: Object.freeze([]),
    }),
    findings: Object.freeze(findings),
  });
}


function effectTargetFromDefinition(
  root: string,
  definition: ProjectDefinition,
): readonly RuntimeArtifactManifestEffectTarget[] {
  if (definition.kind !== "effect") return [];
  const metadata = definition.metadata;
  const facts =
    metadata?.facts && typeof metadata.facts === "object"
      ? (metadata.facts as Record<string, unknown>)
      : undefined;
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
  if (
    definition.kind !== "flow" &&
    definition.kind !== "task" &&
    definition.kind !== "agent"
  )
    return [];
  const exportName =
    typeof definition.metadata?.exportName === "string"
      ? definition.metadata.exportName
      : undefined;
  const file = definition.source?.file;
  if (definition.kind === "agent" && definition.metadata?.exported !== true)
    return [];
  if (!exportName || !file) return [];
  return [
    {
      name: definition.name,
      kind: definition.kind,
      module: `./${relative(root, file).replace(/\\/g, "/")}`,
      export: exportName,
      definitionId: definition.id,
      fingerprint: requiredFingerprint(definition),
    },
  ];
}

function providerFromDefinition(
  root: string,
  definition: ProjectDefinition,
): readonly RuntimeArtifactManifestProvider[] {
  if (definition.kind !== "signal.provider") return [];
  if (definition.metadata?.exported !== true) return [];
  const exportName =
    typeof definition.metadata?.exportName === "string"
      ? definition.metadata.exportName
      : undefined;
  const file = definition.source?.file;
  if (!exportName || !file) return [];
  return [
    {
      id: definition.name,
      module: `./${relative(root, file).replace(/\\/g, "/")}`,
      export: exportName,
      definitionId: definition.id,
      fingerprint: requiredFingerprint(definition),
    },
  ];
}

function transportFromDefinition(
  root: string,
  definition: ProjectDefinition,
): readonly RuntimeArtifactManifestTransport[] {
  if (definition.kind !== "signal.transportBinding") return [];
  if (definition.metadata?.exported !== true) return [];
  const exportName =
    typeof definition.metadata?.exportName === "string"
      ? definition.metadata.exportName
      : undefined;
  const file = definition.source?.file;
  const facts = definition.metadata?.facts as
    | {
        readonly providerId?: string;
        readonly signalId?: string;
        readonly bindingId?: string;
      }
    | undefined;
  const providerId =
    typeof facts?.providerId === "string" ? facts.providerId : undefined;
  const signalId =
    typeof facts?.signalId === "string" ? facts.signalId : undefined;
  if (!exportName || !file || !providerId || !signalId) return [];
  return [
    {
      id:
        typeof facts?.bindingId === "string" && facts.bindingId.length > 0
          ? facts.bindingId
          : definition.name,
      module: `./${relative(root, file).replace(/\\/g, "/")}`,
      export: exportName,
      definitionId: definition.id,
      fingerprint: requiredFingerprint(definition),
      providerId,
      signalId,
    },
  ];
}

function requiredFingerprint(definition: ProjectDefinition): string {
  if (definition.fingerprint) return definition.fingerprint;
  throw new TypeError(
    `Runtime target '${definition.id}' is missing its Project Index fingerprint.`,
  );
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

function duplicateIdentityFindings(
  kind: "provider" | "transport",
  entries: readonly { readonly id: string; readonly module: string }[],
): readonly RuntimeArtifactFinding[] {
  const byId = new Map<
    string,
    { readonly id: string; readonly module: string }[]
  >();
  for (const entry of entries) {
    const matching = byId.get(entry.id) ?? [];
    matching.push(entry);
    byId.set(entry.id, matching);
  }
  return [...byId]
    .filter((entry) => entry[1].length > 1)
    .map(([id, matching]) => ({
      code: "TARGET_DUPLICATE",
      category: "authored" as const,
      featureKind: kind,
      featureId: id,
      source: matching[0]?.module.replace(/^\.\//, ""),
      summary: `Runtime Signal ${kind} '${id}' is declared more than once.`,
      reason: `Crux found ${matching.length} definitions with that durable identity and cannot choose between them.`,
      whatStillWorks: `Other uniquely identified ${kind}s can still be discovered.`,
      remediation: `Rename one ${kind} or remove the duplicate definition.`,
    }));
}

function missingProviderFindings(
  providers: readonly RuntimeArtifactManifestProvider[],
  transports: readonly RuntimeArtifactManifestTransport[],
): readonly RuntimeArtifactFinding[] {
  const providerIds = new Set(providers.map((provider) => provider.id));
  return transports
    .filter((transport) => !providerIds.has(transport.providerId))
    .map((transport) => ({
      code: "CAPABILITY_MISSING",
      category: "authored" as const,
      featureKind: "transport",
      featureId: transport.id,
      source: transport.module.replace(/^\.\//, ""),
      summary: `Runtime transport binding '${transport.id}' has no executable Signal provider.`,
      reason: `Managed-transport normalization requires an exported signalProvider() whose id is '${transport.providerId}'.`,
      whatStillWorks:
        "Bindings whose provider identity matches an exported program provider remain valid.",
      remediation:
        "Export a signalProvider() with that id and include it in the generated Runtime program.",
    }));
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
