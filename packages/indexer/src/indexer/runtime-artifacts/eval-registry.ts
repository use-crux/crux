import { relative } from "node:path";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import type { RuntimeArtifactManifestEval } from "@use-crux/core/runtime";
import type * as EvalNodeRunnerCore from "@use-crux/core/eval/internal/node-runner";
import { importUserSpecifier } from "../imports";

type HydratedEval = EvalNodeRunnerCore.HydratedEval;

export interface GeneratedEvalArtifacts {
  readonly manifestEntries: readonly RuntimeArtifactManifestEval[];
  readonly entryImports: readonly string[];
  readonly registrySource: string;
}

/** Discover and hydrate deployed Evals while requiring Index corroboration. */
export async function generateEvalArtifacts(input: {
  readonly root: string;
  readonly outputFile: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly importSpecifier: (sourceFile: string) => string;
}): Promise<GeneratedEvalArtifacts> {
  const parentFile = `${input.root}/package.json`;
  const nodeRunner = (await importUserSpecifier(
    "@use-crux/core/eval/internal/node-runner",
    parentFile,
    4_000,
  )) as typeof EvalNodeRunnerCore;
  const discovered = await nodeRunner.discoverDeployableProjectEvals(
    input.root,
  );
  if (discovered.errors.length > 0) {
    throw new TypeError(
      discovered.errors.map((error) => error.message).join("\n"),
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
  const variants = nodeRunner.projectDeployedEvalVariants(entry.eval);
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
      [...variants].sort((left, right) =>
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
      requiredHostCapabilities,
      index: indexFacts,
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
      definition.kind === "evaluation" &&
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

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
