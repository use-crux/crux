import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type { RuntimeArtifactManifestEval } from "@use-crux/core/runtime";
import type * as EvalNodeRunnerCore from "@use-crux/core/eval/internal/node-runner";
import { importUserSpecifier, withUserImportSession } from "../imports";

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
  const deployableDefinitions = runtimeEvalDefinitions(
    input.root,
    input.definitions,
  );
  const discovered = await nodeRunner.discoverDeployableProjectEvals(
    input.root,
    {
      relativeFiles: deployableDefinitions.map(
        (definition) => definition.relativeFile,
      ),
    },
  );
  if (discovered.errors.length > 0) {
    throw new TypeError(
      discovered.errors
        .map((error) => contextualImportError(error, deployableDefinitions))
        .join("\n"),
    );
  }
  const hydrated = await Promise.all(
    discovered.evals.map((entry) =>
      nodeRunner.hydrateEvalCases(entry, { projectRoot: input.root }),
    ),
  );
  const projected = hydrated
    .map((entry, index) => projectEntry(entry, index, input, nodeRunner))
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
): readonly RuntimeEvalDefinition[] {
  return Object.freeze(
    definitions.flatMap((definition) => {
      if (
        definition.kind !== "eval" ||
        definition.metadata?.evalContract !== "crux.eval" ||
        definition.metadata?.exportName !== "default"
      ) {
        return [];
      }
      if (definition.source?.file === undefined) {
        throw new TypeError(
          `Project Index source facts for Eval '${definition.name}' are missing. Run crux index reindex, then crux runtime generate.`,
        );
      }
      const relativeFile = projectPath(root, definition.source.file);
      const arms = decodeExecutionArmFacts(
        definition.metadata.evalExecutionArms,
      );
      if (arms === undefined || arms.length === 0) {
        throw new TypeError(
          `Project Index execution facts for Eval '${definition.name}' at '${relativeFile}' are missing or malformed. Run crux index reindex, then crux runtime generate.`,
        );
      }
      const invalid = arms.find((arm) => arm.status === "invalid");
      if (invalid !== undefined) {
        throw new TypeError(
          `Eval '${definition.name}' arm '${invalid.name}' at '${relativeFile}' cannot be prepared: ${invalid.reason}`,
        );
      }
      if (
        !arms.some(
          (arm) => arm.status === "ready" && arm.execution === "runtime",
        )
      )
        return [];
      return [
        Object.freeze({
          id: definition.name,
          relativeFile,
        }),
      ];
    }),
  );
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
      typeof arm.code === "string" &&
      typeof arm.reason === "string"
    ) {
      return [{ status: "invalid", name: arm.name, reason: arm.reason }];
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

function contextualImportError(
  error: { readonly file: string; readonly message: string },
  definitions: readonly RuntimeEvalDefinition[],
): string {
  const definition = definitions.find(
    (candidate) => candidate.relativeFile === error.file,
  );
  return definition === undefined
    ? error.message
    : `Eval '${definition.id}' at '${error.file}' could not be imported for Runtime generation. ${error.message}`;
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
