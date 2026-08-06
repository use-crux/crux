import { dirname, join } from "node:path";
import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import type { GeneratedEvalArtifacts } from "./eval-registry";
import { GENERATED_HEADER } from "./generated-files";
import { importSpecifier } from "./import-specifier";
import {
  providerImports,
  providerLocalNames,
  transportImports,
  transportLocalNames,
} from "./program-providers";

export { importSpecifier } from "./import-specifier";

/** Render the canonical Runtime program shared by generated host entries. */
export function runtimeProgramFile(input: {
  readonly artifactManifestHash: string;
  readonly manifest: RuntimeArtifactManifest;
  readonly outputFile: string;
  readonly root: string;
}): string {
  return [
    GENERATED_HEADER,
    "import { createRuntimeProgram, type RuntimeProgramTargetInput } from '@use-crux/core/runtime'",
    ...targetImports(input.manifest, input.outputFile, input.root),
    ...effectTargetImports(input.manifest, input.outputFile, input.root),
    ...providerImports(input.manifest, input.outputFile, input.root),
    ...transportImports(input.manifest, input.outputFile, input.root),
    "",
    `export const runtimeArtifactManifestHash = '${input.artifactManifestHash}'`,
    "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
    "",
    `const targets = [${targetProgramDeclarations(input.manifest).join(", ")}] as const satisfies readonly RuntimeProgramTargetInput[]`,
    `const effectTargets = [${effectTargetLocalNames(input.manifest).join(", ")}] as const`,
    "const generationModels = [] as const",
    `const providers = [${providerLocalNames(input.manifest).join(", ")}] as const`,
    `const transports = [${transportLocalNames(input.manifest).join(", ")}] as const`,
    "",
    "export const runtimeProgram = createRuntimeProgram({ targets, effectTargets, generationModels, providers, transports })",
    "",
  ].join("\n");
}

/** Render the generated Next runtime entry. */
export function nextEntryFile(input: {
  readonly manifest: RuntimeArtifactManifest;
  readonly outputFile: string;
  readonly root: string;
  readonly evalArtifacts: GeneratedEvalArtifacts;
}): string {
  const hasEvals = input.evalArtifacts.manifestEntries.length > 0;
  return [
    GENERATED_HEADER,
    "import { createRuntimeHandler } from '@use-crux/core/runtime'",
    "import { createDeployedEvalRegistry } from '@use-crux/core/runtime/internal/eval-registry'",
    `import { runtimeProgram } from '${importSpecifier(dirname(input.outputFile), join(input.root, ".crux/generated/runtime/program.ts"))}'`,
    ...(hasEvals
      ? [
          "import type { InProcessRuntimeEngineDefinition } from '@use-crux/core/runtime'",
          "import { createServerlessEvalHost, type EvalHostStore, type ServerlessEvalHost } from '@use-crux/core/runtime/internal/eval-host'",
          `import projectConfig from '${importSpecifier(dirname(input.outputFile), join(input.root, "crux.config"))}'`,
        ]
      : []),
    ...input.evalArtifacts.entryImports,
    "",
    registryDeclaration("evalRegistry", input.evalArtifacts),
    ...(hasEvals ? evalHostCapabilityLines([]) : []),
    "",
    ...(hasEvals
      ? nextEvalHostLines()
      : [
          "export const { GET, POST } = createRuntimeHandler({ program: runtimeProgram })",
        ]),
    "",
  ].join("\n");
}

/** Render the registry and target module consumed by a Cloudflare Worker entry. */
export function cloudflareGeneratedEntryFile(input: {
  readonly manifest: RuntimeArtifactManifest;
  readonly outputFile: string;
  readonly root: string;
  readonly evalArtifacts: GeneratedEvalArtifacts;
}): string {
  return [
    GENERATED_HEADER,
    "import { createDeployedEvalRegistry } from '@use-crux/core/runtime/internal/eval-registry'",
    ...targetImports(input.manifest, input.outputFile, input.root),
    ...input.evalArtifacts.entryImports,
    "",
    `export const runtimeTargets = [${targetLocalNames(input.manifest).join(", ")}] as const`,
    registryDeclaration("deployedEvals", input.evalArtifacts),
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

/** Render the Convex HTTP router that exposes the authenticated Eval protocol. */
export function convexHttpEntryFile(): string {
  return [
    GENERATED_HEADER,
    "import { httpRouter } from 'convex/server'",
    "import { registerCruxEvalRoutes } from './_crux/http'",
    "",
    "const http = registerCruxEvalRoutes(httpRouter())",
    "",
    "export default http",
    "",
  ].join("\n");
}

/** Render composable Eval routes for apps that already own `convex/http.ts`. */
export function convexHttpRoutesFile(): string {
  return [
    GENERATED_HEADER,
    "import { httpRouter } from 'convex/server'",
    "import { createConvexEvalHttpAction } from '@use-crux/convex/runtime'",
    "",
    "type ConvexHttpRouter = ReturnType<typeof httpRouter>",
    "",
    "export function registerCruxEvalRoutes(http: ConvexHttpRouter): ConvexHttpRouter {",
    "  const handler = createConvexEvalHttpAction()",
    "  http.route({ path: '/manifest', method: 'GET', handler })",
    "  http.route({ path: '/jobs', method: 'POST', handler })",
    "  http.route({ pathPrefix: '/jobs/', method: 'GET', handler })",
    "  http.route({ pathPrefix: '/jobs/', method: 'DELETE', handler })",
    "  return http",
    "}",
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
    registryDeclaration("evalRegistry", input.evalArtifacts),
    ...evalHostCapabilityLines(["record-store", "search-store"]),
    "",
    "const deploymentId = process.env.CONVEX_CLOUD_URL",
    "if (!deploymentId) throw new Error('Generated Crux Eval host requires Convex to provide CONVEX_CLOUD_URL.')",
    "const evalHostToken = process.env.CRUX_EVAL_HOST_TOKEN",
    "",
    "const runtime = createConvexRuntimeTargetExecutor({ component: components.crux, targets })",
    "const evalHost = createConvexEvalHost({",
    "  component: components.crux,",
    "  registry: evalRegistry,",
    "  deploymentId,",
    "  token: evalHostToken,",
    "  hostCapabilities: evalHostCapabilities,",
    "  targetExecutor: runtime.executeTarget,",
    "})",
    "",
    "export const { executeTarget } = runtime",
    "export const { executeEvalTarget, handleEvalRequest } = evalHost",
    "",
  ].join("\n");
}

function targetImports(
  manifest: RuntimeArtifactManifest,
  outputFile: string,
  root: string,
): string[] {
  return manifest.targets.map((target, index) => {
    const sourceFile = join(root, target.module.replace(/^\.\//, ""));
    const specifier = importSpecifier(dirname(outputFile), sourceFile);
    return `import { ${target.export} as ${targetLocalName(index)} } from ${JSON.stringify(specifier)}`;
  });
}


function effectTargetImports(
  manifest: RuntimeArtifactManifest,
  outputFile: string,
  root: string,
): string[] {
  return (manifest.effectTargets ?? []).map((target, index) => {
    const sourceFile = join(root, target.module.replace(/^\.\//, ""));
    const specifier = importSpecifier(dirname(outputFile), sourceFile);
    return `import { ${target.export} as ${effectTargetLocalName(index)} } from ${JSON.stringify(specifier)}`;
  });
}

function effectTargetLocalNames(
  manifest: RuntimeArtifactManifest,
): string[] {
  return (manifest.effectTargets ?? []).map((_, index) =>
    effectTargetLocalName(index),
  );
}

function effectTargetLocalName(index: number): string {
  return `effectTarget${index}`;
}

function targetLocalNames(manifest: RuntimeArtifactManifest): string[] {
  return manifest.targets.map((_, index) => targetLocalName(index));
}

function targetProgramDeclarations(
  manifest: RuntimeArtifactManifest,
): string[] {
  return manifest.targets.map(
    (target, index) =>
      `{ target: ${targetLocalName(index)}, definition: { id: ${JSON.stringify(target.definitionId)}, fingerprint: ${JSON.stringify(target.fingerprint)} } }`,
  );
}

function targetLocalName(index: number): string {
  return `target${index}`;
}

function registryDeclaration(
  name: string,
  evalArtifacts: GeneratedEvalArtifacts,
): string {
  return `export const ${name} = createDeployedEvalRegistry({persistencePolicy:{redactPaths:${JSON.stringify(evalArtifacts.redactPaths)}},entries:${evalArtifacts.registrySource}})`;
}

function nextEvalHostLines(): string[] {
  return [
    "const runtime = projectConfig.config.runtime",
    "const runtimeHandlers = createRuntimeHandler({ program: runtimeProgram, runtime })",
    "let evalHost: ServerlessEvalHost<EvalHostStore> | undefined",
    "",
    "async function dispatch(request: Request): Promise<Response> {",
    "  const route = evalHostRoute(new URL(request.url).pathname)",
    "  if (route) {",
    "    try {",
    "      const url = new URL(request.url)",
    "      url.pathname = route",
    "      return resolvedEvalHost().fetch(new Request(url, request))",
    "    } catch (error) {",
    "      const message = error instanceof Error ? error.message : 'Eval host setup is incomplete.'",
    "      return new Response(JSON.stringify({ error: { code: 'EVAL_HOST_SETUP_REQUIRED', message } }), {",
    "        status: 503,",
    "        headers: { 'content-type': 'application/json' },",
    "      })",
    "    }",
    "  }",
    "  if (request.method === 'GET') return runtimeHandlers.GET(request)",
    "  if (request.method === 'POST') return resolvedEvalHost().wake(request)",
    "  return new Response('Method not allowed', { status: 405 })",
    "}",
    "",
    "function resolvedEvalHost(): ServerlessEvalHost<EvalHostStore> {",
    "  if (evalHost) return evalHost",
    "  if (!runtime || runtime.kind !== 'in-process') {",
    "    throw new Error('Generated Next Eval hosting requires an in-process serverless() Runtime with durable result storage.')",
    "  }",
    "  const deploymentId = process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID",
    "  if (!deploymentId) throw new Error('Set CRUX_EVAL_HOST_DEPLOYMENT_ID for the generated Eval host.')",
    "  const token = process.env.CRUX_EVAL_HOST_TOKEN",
    "  if (!token) throw new Error('Set CRUX_EVAL_HOST_TOKEN for the generated Eval host.')",
    "  evalHost = createServerlessEvalHost({",
    "    registry: evalRegistry,",
    "    runtime: runtime as InProcessRuntimeEngineDefinition<EvalHostStore>,",
    "    deploymentId,",
    "    token,",
    "    hostCapabilities: evalHostCapabilities,",
    "    targets: runtimeProgram.targets,",
    "  })",
    "  return evalHost",
    "}",
    "",
    "function evalHostRoute(pathname: string): string | undefined {",
    "  const match = /\\/(manifest|jobs(?:\\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127})?)$/.exec(pathname)",
    "  return match?.[1] ? `/${match[1]}` : undefined",
    "}",
    "",
    "export const GET = dispatch",
    "export const POST = dispatch",
    "export const DELETE = dispatch",
  ];
}

function evalHostCapabilityLines(supported: readonly string[]): string[] {
  const supportedSource = `[${supported.map((value) => `'${value}'`).join(", ")}]`;
  return [
    `const supportedEvalHostCapabilities = ${supportedSource} as readonly string[]`,
    "const evalHostCapabilities = Object.freeze([...new Set(evalRegistry.entries.flatMap((entry) => entry.requiredHostCapabilities))]",
    "  .filter((capability) => supportedEvalHostCapabilities.includes(capability))",
    "  .sort())",
  ];
}
