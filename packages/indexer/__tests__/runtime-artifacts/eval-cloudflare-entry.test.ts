import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeEvalDefinitions } from "../../src/indexer/eval-discovery";
import { generateRuntimeArtifacts } from "../../src/indexer/runtime-artifacts";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("generated Cloudflare Eval registry", () => {
  it("writes a registry module consumable by the Worker host", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "export default {",
        "  config: { runtime: { kind: 'host-bound', host: 'cloudflare', id: 'cloudflare', capabilities: {} } },",
        "  prompts: [], contexts: [], get() { return undefined },",
        "}",
      ].join("\n"),
    );
    const source = join(root, "evals/support.eval.ts");
    const targetFile = join(root, "src/nested.ts");
    await mkdir(dirname(source), { recursive: true });
    await mkdir(dirname(targetFile), { recursive: true });
    await writeFile(
      targetFile,
      [
        "import { durableTask } from '@use-crux/core/runtime'",
        "export const nested = durableTask('nested', { run: async () => undefined })",
      ].join("\n"),
    );
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk', capabilities: [], requiredHostCapabilities: [], overrideKeys: [], defaults: {},",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }), execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output, projectResponse: (() => ({})) as never,",
        "})",
        "export default evaluate({ id: 'support', task, cases: [{ id: 'refund', input: { question: 'refund?' } }] })",
      ].join("\n"),
    );
    const evalDefinitions = (
      await discoverRuntimeEvalDefinitions(root, ["**/*.eval.ts"], [])
    ).definitions;
    const definitions = [
      ...evalDefinitions,
      {
        id: "task:nested",
        kind: "task",
        name: "nested",
        fidelity: "resolved",
        source: { file: targetFile, line: 1 },
        metadata: { exportName: "nested" },
      },
    ] satisfies readonly ProjectDefinition[];

    const result = await generateRuntimeArtifacts({ root, definitions });
    const generated = await readFile(
      join(root, "cloudflare/_crux/generated.ts"),
      "utf8",
    );
    const workerFile = join(root, "cloudflare/worker.ts");
    await writeFile(
      workerFile,
      [
        "import { createCloudflareEvalHost } from '@use-crux/cloudflare'",
        "import { deployedEvals, runtimeTargets } from './_crux/generated'",
        "interface Env { CRUX_EVAL_HOST: DurableObjectNamespace; CRUX_EVAL_HOST_TOKEN: string }",
        "const host = createCloudflareEvalHost<Env>({",
        "  binding: 'CRUX_EVAL_HOST', deploymentId: 'production-eu', registry: deployedEvals,",
        "  targets: runtimeTargets, token: (env) => env.CRUX_EVAL_HOST_TOKEN,",
        "})",
        "export const CruxEvalHost = host.DurableObject",
        "export default { fetch: host.fetch }",
      ].join("\n"),
    );

    expect(result.writtenFiles).toContain(
      join(root, "cloudflare/_crux/generated.ts"),
    );
    expect(result.manifest.evals).toHaveLength(1);
    expect(generated).toContain("export const deployedEvals");
    expect(generated).toContain("export const runtimeTargets");
    expect(generated).toContain("import { nested as target0 }");
    expect(generated).toContain("runtimeTargets = [target0] as const");
    expect(generated).toContain("import eval0 from '../../evals/support.eval'");
    expect(generated).not.toMatch(/prompt|model|apiKey|credential/i);
    expect(typecheckGeneratedCloudflareWorker(workerFile)).toEqual([]);
  });
});

function typecheckGeneratedCloudflareWorker(workerFile: string): string[] {
  const program = ts.createProgram({
    rootNames: [
      workerFile,
      join(
        workspaceRoot,
        "../cloudflare/node_modules/@cloudflare/workers-types/index.d.ts",
      ),
    ],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: join(workspaceRoot, "../.."),
      paths: {
        "@use-crux/cloudflare": ["packages/cloudflare/src/index.ts"],
        "@use-crux/core": ["packages/core/src/index.ts"],
        "@use-crux/core/runtime": ["packages/core/src/runtime/public.ts"],
        "@use-crux/core/runtime/internal/eval-host": [
          "packages/core/src/runtime/eval-host/index.ts",
        ],
        "@use-crux/core/runtime/internal/eval-registry": [
          "packages/core/src/runtime/eval-registry/index.ts",
        ],
        "@use-crux/core/eval": ["packages/core/src/eval/index.ts"],
        "@use-crux/core/eval/internal/task": [
          "packages/core/src/eval/internal/task.ts",
        ],
        "@use-crux/core/*": ["packages/core/src/*"],
      },
    },
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
}
