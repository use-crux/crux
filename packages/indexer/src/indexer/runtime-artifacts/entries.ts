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
  const hasEvals = input.evalArtifacts.manifestEntries.length > 0;
  return [
    GENERATED_HEADER,
    "import { createRuntimeHandler } from '@use-crux/core/runtime'",
    "import { createDeployedEvalRegistry } from '@use-crux/core/runtime/internal/eval-registry'",
    ...(hasEvals
      ? [
          "import type { InProcessRuntimeEngineDefinition } from '@use-crux/core/runtime'",
          "import { createServerlessEvalHost, type EvalHostStore, type ServerlessEvalHost } from '@use-crux/core/runtime/internal/eval-host'",
          "import projectConfig from '../crux.config'",
        ]
      : []),
    ...targetImports(input.manifest, input.outputFile, input.root),
    ...input.evalArtifacts.entryImports,
    "",
    `const targets = [${targetLocalNames(input.manifest).join(", ")}] as const`,
    registryDeclaration("evalRegistry", input.evalArtifacts),
    ...evalHostCapabilityLines([]),
    "",
    ...(hasEvals
      ? nextEvalHostLines(input.manifestHash)
      : [
          `export const { GET, POST } = createRuntimeHandler({ targets, manifestHash: '${input.manifestHash}' })`,
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
    "import { api } from '../_generated/api'",
    "",
    "type ConvexHttpRouter = ReturnType<typeof httpRouter>",
    "",
    "export function registerCruxEvalRoutes(http: ConvexHttpRouter): ConvexHttpRouter {",
    "  const handler = api._crux.targets.handleEvalRequest",
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
    ...evalHostCapabilityLines(["record-store", "vector-store"]),
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
    "  hostCapabilities: evalHostCapabilities,",
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

function registryDeclaration(
  name: string,
  evalArtifacts: GeneratedEvalArtifacts,
): string {
  return `export const ${name} = createDeployedEvalRegistry({persistencePolicy:{redactPaths:${JSON.stringify(evalArtifacts.redactPaths)}},entries:${evalArtifacts.registrySource}})`;
}

function nextEvalHostLines(manifestHash: string): string[] {
  return [
    "const runtime = projectConfig.config.runtime",
    `const runtimeHandlers = createRuntimeHandler({ targets, runtime, manifestHash: '${manifestHash}' })`,
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
    "    targets,",
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
