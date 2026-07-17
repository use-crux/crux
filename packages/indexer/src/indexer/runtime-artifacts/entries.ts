import { dirname, join, relative } from "node:path";
import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import type { GeneratedEvalArtifacts } from "./eval-registry";
import { GENERATED_HEADER } from "./generated-files";

/** Render the generated Next runtime entry. */
export function nextEntryFile(input: {
  readonly manifest: RuntimeArtifactManifest;
  readonly outputFile: string;
  readonly root: string;
  readonly manifestHash: string;
  readonly evalArtifacts: GeneratedEvalArtifacts;
}): string {
  return [
    GENERATED_HEADER,
    "import { createRuntimeHandler } from '@use-crux/core/runtime'",
    "import { createDeployedEvalRegistry } from '@use-crux/core/runtime/internal/eval-registry'",
    ...targetImports(input.manifest, input.outputFile, input.root),
    ...input.evalArtifacts.entryImports,
    "",
    `const targets = [${targetLocalNames(input.manifest).join(", ")}] as const`,
    `export const evalRegistry = createDeployedEvalRegistry({ entries: ${input.evalArtifacts.registrySource} })`,
    "",
    `export const { GET, POST } = createRuntimeHandler({ targets, manifestHash: '${input.manifestHash}' })`,
    "",
  ].join("\n");
}

/** Render the generated Convex runtime handler entry. */
export function convexGeneratedEntryFile(): string {
  return [
    GENERATED_HEADER,
    "import { makeFunctionReference } from 'convex/server'",
    "import { createConvexRuntimeHandlers } from '@use-crux/convex/runtime'",
    "import { components } from '../_generated/api'",
    "",
    "const targetExecutor = makeFunctionReference<'action', { envelope: unknown }, unknown>(",
    "  '_crux/targets:executeTarget',",
    ")",
    "",
    "const runtime = createConvexRuntimeHandlers({ component: components.crux, targetExecutor })",
    "",
    "export const { deliverSignal, fireTimer, handleWake, resumeFlow, runTask } = runtime",
    "",
  ].join("\n");
}

/** Render the generated Convex target executor and deployed Eval registry. */
export function convexTargetEntryFile(input: {
  readonly manifest: RuntimeArtifactManifest;
  readonly outputFile: string;
  readonly root: string;
  readonly evalArtifacts: GeneratedEvalArtifacts;
}): string {
  return [
    GENERATED_HEADER,
    "'use node'",
    "",
    "import { createConvexEvalHost, createConvexRuntimeTargetExecutor } from '@use-crux/convex/runtime/node'",
    "import { createDeployedEvalRegistry } from '@use-crux/core/runtime/internal/eval-registry'",
    "import { components } from '../_generated/api'",
    ...targetImports(input.manifest, input.outputFile, input.root),
    ...input.evalArtifacts.entryImports,
    "",
    `const targets = [${targetLocalNames(input.manifest).join(", ")}] as const`,
    `export const evalRegistry = createDeployedEvalRegistry({ entries: ${input.evalArtifacts.registrySource} })`,
    "",
    "const deploymentId = process.env.CONVEX_DEPLOYMENT",
    "if (!deploymentId) throw new Error('Generated Crux Eval host requires CONVEX_DEPLOYMENT.')",
    "const evalHostToken = process.env.CRUX_EVAL_HOST_TOKEN",
    "if (!evalHostToken) throw new Error('Generated Crux Eval host requires CRUX_EVAL_HOST_TOKEN.')",
    "",
    "const runtime = createConvexRuntimeTargetExecutor({ component: components.crux, targets })",
    "const evalHost = createConvexEvalHost({",
    "  component: components.crux,",
    "  registry: evalRegistry,",
    "  deploymentId,",
    "  token: evalHostToken,",
    "  targetExecutor: runtime.executeTarget,",
    "})",
    "",
    "export const { executeTarget } = runtime",
    "export const { executeEvalTarget, handleEvalRequest } = evalHost",
    "",
  ].join("\n");
}

/** Create a stable relative source import without its TypeScript extension. */
export function importSpecifier(fromDir: string, toFile: string): string {
  const withoutExtension = toFile.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
  let specifier = relative(fromDir, withoutExtension).replace(/\\/g, "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function targetImports(
  manifest: RuntimeArtifactManifest,
  outputFile: string,
  root: string,
): string[] {
  return manifest.targets.map((target, index) => {
    const sourceFile = join(root, target.module.replace(/^\.\//, ""));
    const specifier = importSpecifier(dirname(outputFile), sourceFile);
    return `import { ${target.export} as ${targetLocalName(index)} } from '${specifier}'`;
  });
}

function targetLocalNames(manifest: RuntimeArtifactManifest): string[] {
  return manifest.targets.map((_, index) => targetLocalName(index));
}

function targetLocalName(index: number): string {
  return `target${index}`;
}
