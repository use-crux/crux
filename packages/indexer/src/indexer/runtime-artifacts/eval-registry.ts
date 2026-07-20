import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type { RuntimeArtifactManifestEval } from "@use-crux/core/runtime";
import type * as EvalNodeRunnerCore from "@use-crux/core/eval/internal/node-runner";
import { importUserSpecifier, withUserImportSession } from "../imports";
import {
  RuntimeArtifactGenerationError,
  runtimeArtifactFindingFromError,
} from "./findings";
import type { RuntimeArtifactFinding } from "./types";

type HydratedEval = EvalNodeRunnerCore.HydratedEval;

export interface GeneratedEvalArtifacts {
  readonly manifestEntries: readonly RuntimeArtifactManifestEval[];
  readonly entryImports: readonly string[];
  readonly registrySource: string;
  readonly redactPaths: readonly string[];
  readonly privacyFingerprint: string;
}

/** Discover and hydrate deployed Evals while requiring Index corroboration. */
export async function generateEvalArtifacts(input: {
  readonly root: string;
  readonly outputFile: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly importSpecifier: (sourceFile: string) => string;
  readonly redactPaths?: unknown;
}): Promise<GeneratedEvalArtifacts> {
  return withUserImportSession(() => generateEvalArtifactsInSession(input));
}

async function generateEvalArtifactsInSession(input: {
  readonly root: string;
  readonly outputFile: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly importSpecifier: (sourceFile: string) => string;
  readonly redactPaths?: unknown;
}): Promise<GeneratedEvalArtifacts> {
  const parentFile = `${input.root}/package.json`;
  const nodeRunner = (await importUserSpecifier(
    "@use-crux/core/eval/internal/node-runner",
    parentFile,
    4_000,
  )) as typeof EvalNodeRunnerCore;
  const persistencePolicy = nodeRunner.normalizeEvalPersistencePolicy({
    redactPaths: input.redactPaths,
  });
  const selection = runtimeEvalDefinitions(input.root, input.definitions);
  const deployableDefinitions = selection.definitions;
  const findings = [...selection.findings];
  const discovered = await nodeRunner.discoverDeployableProjectEvals(
    input.root,
    {
      relativeFiles: deployableDefinitions.map(
        (definition) => definition.relativeFile,
      ),
    },
  );
  findings.push(
    ...discovered.errors.map((error) =>
      importFinding(error, deployableDefinitions),
    ),
  );
  const hydrationResults = await Promise.allSettled(
    discovered.evals.map((entry) =>
      nodeRunner.hydrateEvalCases(entry, { projectRoot: input.root }),
    ),
  );
  findings.push(
    ...hydrationResults.flatMap((result, index) =>
      result.status === "fulfilled"
        ? []
        : [
            runtimeArtifactFindingFromError(result.reason, {
              code: "RUNTIME_EVAL_CASE_INVALID",
              category: "authored",
              featureKind: "eval",
              featureId: discovered.evals[index]?.id,
              source: discovered.evals[index]?.sourceKey.relativeFile,
              summary: `Eval '${discovered.evals[index]?.id ?? "unknown"}' Cases could not be prepared.`,
              whatStillWorks:
                "Other Eval definitions and local Runtime targets are unchanged.",
              remediation:
                "Fix the reported Case data in this Eval and save the file.",
            }),
          ],
    ),
  );
  const hydrated = hydrationResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const projectionResults = hydrated.map((entry, index) => {
    try {
      return {
        status: "ready",
        entry: projectEntry(entry, index, input, nodeRunner),
      } as const;
    } catch (error) {
      const finding = projectedEvalFinding(error, entry);
      return {
        status: "invalid",
        finding,
        cause: finding.category === "internal" ? error : undefined,
      } as const;
    }
  });
  findings.push(
    ...projectionResults.flatMap((result) =>
      result.status === "invalid" ? [result.finding] : [],
    ),
  );
  if (findings.length > 0) {
    const causes = projectionResults.flatMap((result) =>
      result.status === "invalid" && result.cause !== undefined
        ? [result.cause]
        : [],
    );
    throw new RuntimeArtifactGenerationError(
      findings,
      causes.length > 0 ? { cause: Object.freeze(causes) } : {},
    );
  }
  const projected = projectionResults
    .flatMap((result) => (result.status === "ready" ? [result.entry] : []))
    .sort((left, right) =>
      compareCodepoint(left.manifest.id, right.manifest.id),
    );
  return Object.freeze({
    manifestEntries: Object.freeze(projected.map((entry) => entry.manifest)),
    entryImports: Object.freeze(projected.map((entry) => entry.importLine)),
    registrySource: registrySource(projected.map((entry) => entry.registry)),
    redactPaths: persistencePolicy.redactPaths,
    privacyFingerprint:
      nodeRunner.fingerprintEvalPersistencePolicy(persistencePolicy),
  });
}

interface RuntimeEvalDefinition {
  readonly id: string;
  readonly relativeFile: string;
}

function runtimeEvalDefinitions(
  root: string,
  definitions: readonly ProjectDefinition[],
): {
  readonly definitions: readonly RuntimeEvalDefinition[];
  readonly findings: readonly RuntimeArtifactFinding[];
} {
  const deployable: RuntimeEvalDefinition[] = [];
  const findings: RuntimeArtifactFinding[] = [];
  for (const definition of definitions) {
    if (
      definition.kind !== "eval" ||
      definition.metadata?.evalContract !== "crux.eval" ||
      definition.metadata?.exportName !== "default"
    ) {
      continue;
    }
    if (definition.source?.file === undefined) {
      findings.push(missingEvalFactsFinding(definition.name));
      continue;
    }
    const relativeFile = projectPath(root, definition.source.file);
    const arms = decodeExecutionArmFacts(definition.metadata.evalExecutionArms);
    if (arms === undefined || arms.length === 0) {
      findings.push(missingEvalFactsFinding(definition.name, relativeFile));
      continue;
    }
    const invalid = arms.filter((arm) => arm.status === "invalid");
    if (invalid.length > 0) {
      findings.push(
        ...invalid.map((arm) =>
          invalidEvalArmFinding(definition.name, relativeFile, arm),
        ),
      );
      continue;
    }
    if (
      !arms.some((arm) => arm.status === "ready" && arm.execution === "runtime")
    ) {
      continue;
    }
    deployable.push(Object.freeze({ id: definition.name, relativeFile }));
  }
  return Object.freeze({
    definitions: Object.freeze(deployable),
    findings: Object.freeze(findings),
  });
}

type IndexedExecutionArm =
  | {
      readonly status: "ready";
      readonly name: string;
      readonly execution: "coordinator" | "runtime";
    }
  | {
      readonly status: "invalid";
      readonly name: string;
      readonly code:
        | "task_not_callable"
        | "task_contract_incompatible"
        | "variant_invalid";
      readonly reason: string;
    };

function decodeExecutionArmFacts(
  value: unknown,
): readonly IndexedExecutionArm[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arms = value.flatMap((arm): readonly IndexedExecutionArm[] => {
    if (!isRecord(arm) || typeof arm.name !== "string") return [];
    if (
      arm.status === "invalid" &&
      (arm.code === "task_not_callable" ||
        arm.code === "task_contract_incompatible" ||
        arm.code === "variant_invalid") &&
      typeof arm.reason === "string"
    ) {
      return [
        {
          status: "invalid",
          name: arm.name,
          code: arm.code,
          reason: arm.reason,
        },
      ];
    }
    if (
      (arm.execution === "coordinator" || arm.execution === "runtime") &&
      Array.isArray(arm.requiredHostCapabilities) &&
      arm.requiredHostCapabilities.every(
        (capability) => typeof capability === "string",
      )
    ) {
      return [{ status: "ready", name: arm.name, execution: arm.execution }];
    }
    return [];
  });
  return arms.length === value.length ? arms : undefined;
}

function missingEvalFactsFinding(
  evalId: string,
  source?: string,
): RuntimeArtifactFinding {
  return {
    code: "RUNTIME_EVAL_INDEX_FACTS_INVALID",
    category: "internal",
    featureKind: "eval",
    featureId: evalId,
    ...(source ? { source } : {}),
    summary: `Crux could not verify Eval '${evalId}' for Runtime generation.`,
    reason:
      "The current Project Index snapshot is missing valid execution facts for this Eval.",
    whatStillWorks:
      "The authored Eval and the last generated Runtime artifacts are unchanged.",
  };
}

function invalidEvalArmFinding(
  evalId: string,
  source: string,
  arm: Extract<IndexedExecutionArm, { readonly status: "invalid" }>,
): RuntimeArtifactFinding {
  const incompatible = arm.code === "task_contract_incompatible";
  return {
    code: incompatible
      ? "RUNTIME_EVAL_TASK_CONTRACT_INCOMPATIBLE"
      : "RUNTIME_EVAL_INVALID",
    category: incompatible ? "configuration" : "authored",
    featureKind: "eval",
    featureId: evalId,
    arm: arm.name,
    source,
    summary: `Eval '${evalId}' arm '${arm.name}' is not ready.`,
    reason: incompatible
      ? "Installed Crux packages do not share the same Eval task contract."
      : arm.reason.replace(/^planEval\(\):\s*/, ""),
    whatStillWorks:
      "Other Evals and the last generated Runtime artifacts are unchanged.",
    remediation: incompatible
      ? "Install @use-crux/core and the Eval task adapter from the same compatible release."
      : arm.code === "task_not_callable"
        ? "Pass a callable task to evaluate() and save the file."
        : `Fix Variant '${arm.name}' so its task and overrides are compatible with Current, then save the file.`,
  };
}

function importFinding(
  error: { readonly file: string; readonly message: string },
  definitions: readonly RuntimeEvalDefinition[],
): RuntimeArtifactFinding {
  const definition = definitions.find(
    (candidate) => candidate.relativeFile === error.file,
  );
  return {
    code: "RUNTIME_EVAL_IMPORT_FAILED",
    category: "authored",
    featureKind: "eval",
    ...(definition ? { featureId: definition.id } : {}),
    source: error.file,
    summary: definition
      ? `Eval '${definition.id}' could not be loaded from '${error.file}'.`
      : `Eval module '${error.file}' could not be loaded.`,
    reason: error.message,
    whatStillWorks:
      "Other source files and the last generated Runtime artifacts are unchanged.",
    remediation: "Fix the reported import error and save the file.",
  };
}

function projectedEvalFinding(
  error: unknown,
  entry: HydratedEval,
): RuntimeArtifactFinding {
  const message = error instanceof Error ? error.message : String(error);
  const indexDisagreement = message.startsWith("Project Index");
  return runtimeArtifactFindingFromError(error, {
    code: indexDisagreement
      ? "RUNTIME_EVAL_INDEX_FACTS_INVALID"
      : "RUNTIME_EVAL_CASE_INVALID",
    category: indexDisagreement ? "internal" : "authored",
    featureKind: "eval",
    featureId: entry.id,
    source: entry.sourceKey.relativeFile,
    summary: indexDisagreement
      ? `Crux could not verify Eval '${entry.id}' for Runtime generation.`
      : `Eval '${entry.id}' Cases could not be prepared.`,
    whatStillWorks:
      "Other Evals and the last generated Runtime artifacts are unchanged.",
    ...(indexDisagreement
      ? {}
      : {
          remediation:
            "Fix the reported Case data in this Eval and save the file.",
        }),
  });
}

function projectEntry(
  entry: HydratedEval,
  index: number,
  input: Parameters<typeof generateEvalArtifacts>[0],
  nodeRunner: typeof EvalNodeRunnerCore,
) {
  const indexFacts = corroboratingDefinition(
    entry,
    input.root,
    input.definitions,
  );
  const executionArms = nodeRunner.projectEvalExecutionArms(entry.eval);
  const invalid = executionArms.find((arm) => arm.status === "invalid");
  if (invalid !== undefined) {
    throw new TypeError(
      `Eval '${entry.id}' arm '${invalid.name}' cannot be prepared for Runtime execution: ${invalid.reason}`,
    );
  }
  const variants = nodeRunner.projectDeployedEvalVariants(entry.eval);
  const manifestVariants = variants.map((variant) => {
    const arm = executionArms.find(
      (candidate) => candidate.name === variant.name,
    );
    if (arm === undefined || arm.status !== "ready") {
      throw new TypeError(
        `Eval '${entry.id}' arm '${variant.name}' has inconsistent execution metadata.`,
      );
    }
    return Object.freeze({
      ...variant,
      execution: arm.execution,
      requiredHostCapabilities: arm.requiredHostCapabilities,
    });
  });
  const readyExecutionArms = normalizeExecutionArmFacts(manifestVariants);
  if (
    JSON.stringify(readyExecutionArms) !==
    JSON.stringify(normalizeExecutionArmFacts(indexFacts.evalExecutionArms))
  ) {
    throw new TypeError(
      `Project Index arm facts disagree with deployed Eval '${entry.id}'. Run crux index reindex, then crux runtime generate.`,
    );
  }
  const cases = entry.cases.map((evalCase) => ({
    id: evalCase.id,
    fingerprint: nodeRunner.fingerprintDeployedEvalCase(
      evalCase.id,
      evalCase.authored,
    ),
    authored: serializableCase(evalCase.authored),
  }));
  const requiredHostCapabilities =
    nodeRunner.projectDeployedEvalRequiredHostCapabilities(entry.eval);
  const runtimeArms = executionArms.flatMap((arm) =>
    arm.status === "ready" && arm.execution === "runtime"
      ? [
          {
            name: arm.name,
            requiredHostCapabilities: arm.requiredHostCapabilities,
          },
        ]
      : [],
  );
  if (
    JSON.stringify(requiredHostCapabilities) !==
    JSON.stringify(indexFacts.requiredHostCapabilities)
  ) {
    throw new TypeError(
      `Project Index capability facts disagree with deployed Eval '${entry.id}'. Run crux index reindex, then crux runtime generate.`,
    );
  }
  const manifest: RuntimeArtifactManifestEval = Object.freeze({
    id: entry.id,
    module: `./${entry.sourceKey.relativeFile}`,
    export: "default",
    evalFingerprint: entry.definitionFingerprint,
    cases: Object.freeze(
      cases
        .map(({ id, fingerprint }) => Object.freeze({ id, fingerprint }))
        .sort((left, right) => compareCodepoint(left.id, right.id)),
    ),
    variants: Object.freeze(
      [...manifestVariants].sort((left, right) =>
        compareCodepoint(left.name, right.name),
      ),
    ),
    requiredHostCapabilities,
  });
  return {
    manifest,
    importLine: `import eval${index} from '${input.importSpecifier(entry.sourceKey.relativeFile)}'`,
    registry: {
      evalLocal: `eval${index}`,
      id: entry.id,
      source: entry.sourceKey.relativeFile,
      evalFingerprint: entry.definitionFingerprint,
      cases,
      variants,
      runtimeArms,
      requiredHostCapabilities,
      index: {
        id: indexFacts.id,
        source: indexFacts.source,
        requiredHostCapabilities: indexFacts.requiredHostCapabilities,
      },
    },
  };
}

function serializableCase(authored: HydratedEval["cases"][number]["authored"]) {
  const {
    expect: _expect,
    afterScores: _afterScores,
    metadata: _metadata,
    ...serializable
  } = authored;
  return serializable;
}

function corroboratingDefinition(
  entry: HydratedEval,
  root: string,
  definitions: readonly ProjectDefinition[],
) {
  const matches = definitions.filter(
    (definition) =>
      definition.kind === "eval" &&
      definition.name === entry.id &&
      definition.metadata?.evalContract === "crux.eval" &&
      definition.metadata?.exportName === "default" &&
      definition.source?.file !== undefined &&
      projectPath(root, definition.source.file) ===
        entry.sourceKey.relativeFile,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Project Index does not corroborate deployed Eval '${entry.id}' at '${entry.sourceKey.relativeFile}'. Run crux index reindex, then crux runtime generate.`,
    );
  }
  const capabilities = matches[0]!.metadata?.requiredHostCapabilities;
  const evalExecutionArms = matches[0]!.metadata?.evalExecutionArms;
  return Object.freeze({
    id: entry.id,
    source: entry.sourceKey.relativeFile,
    requiredHostCapabilities: Object.freeze(
      Array.isArray(capabilities)
        ? capabilities
            .filter((value): value is string => typeof value === "string")
            .sort(compareCodepoint)
        : [],
    ),
    evalExecutionArms: Object.freeze(
      Array.isArray(evalExecutionArms)
        ? evalExecutionArms.flatMap((arm) =>
            isRecord(arm) &&
            typeof arm.name === "string" &&
            (arm.execution === "coordinator" || arm.execution === "runtime") &&
            Array.isArray(arm.requiredHostCapabilities)
              ? [
                  Object.freeze({
                    name: arm.name,
                    execution: arm.execution,
                    requiredHostCapabilities: Object.freeze(
                      arm.requiredHostCapabilities.filter(
                        (value): value is string => typeof value === "string",
                      ),
                    ),
                  }),
                ]
              : [],
          )
        : [],
    ),
  });
}

function registrySource(
  entries: readonly ReturnType<typeof projectEntry>["registry"][],
): string {
  return `[${entries
    .map((entry) => {
      const data = serializeGeneratedValue({
        id: entry.id,
        source: entry.source,
        evalFingerprint: entry.evalFingerprint,
        cases: entry.cases,
        variants: entry.variants,
        runtimeArms: entry.runtimeArms,
        requiredHostCapabilities: entry.requiredHostCapabilities,
        index: entry.index,
      });
      return `{eval:${entry.evalLocal},${data.slice(1)}`;
    })
    .join(",")}]`;
}

function serializeGeneratedValue(value: unknown): string {
  assertJsonSafe(value, new WeakSet<object>());
  return JSON.stringify(value);
}

function assertJsonSafe(value: unknown, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new TypeError(
      "Deployed Eval registry data must be finite, acyclic JSON and cannot serialize executable values.",
    );
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonSafe(entry, seen);
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "Deployed Eval registry data must contain only JSON objects and arrays.",
    );
  }
  for (const entry of Object.values(value)) assertJsonSafe(entry, seen);
  seen.delete(value);
}

function projectPath(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeExecutionArmFacts(
  arms: readonly {
    readonly name: string;
    readonly execution: "coordinator" | "runtime";
    readonly requiredHostCapabilities: readonly string[];
  }[],
) {
  return arms
    .map((arm) => ({
      name: arm.name,
      execution: arm.execution,
      requiredHostCapabilities: [...arm.requiredHostCapabilities].sort(
        compareCodepoint,
      ),
    }))
    .sort((left, right) =>
      left.name === right.name
        ? 0
        : left.name === "current"
          ? -1
          : right.name === "current"
            ? 1
            : compareCodepoint(left.name, right.name),
    );
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
