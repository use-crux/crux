import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeEvalDefinitions } from "../../src/indexer/eval-discovery";
import { generateRuntimeArtifacts } from "../../src/indexer/runtime-artifacts";
import { importUserModule } from "../../src/indexer/imports";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("generated deployed Eval registry", () => {
  it("imports executable Evals and embeds sorted validated Case identities", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
    const source = join(root, "evals/support.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const inputSchema = { '~standard': { version: 1, vendor: 'fixture', validate: (value: unknown) => ({ value }) } } as const",
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk',",
        "  inputSchema, capabilities: [], requiredHostCapabilities: ['asset-store'], overrideKeys: [],",
        "  defaults: { prompt: 'DO_NOT_SERIALIZE_PROMPT', model: 'DO_NOT_SERIALIZE_MODEL', apiKey: 'DO_NOT_SERIALIZE_CREDENTIAL' },",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),",
        "  execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => ({ output: result.output }),",
        "})",
        "export default evaluate({",
        "  id: 'support', task,",
        "  cases: [{ id: 'z-inline', input: { message: 'inline' } }],",
        "})",
      ].join("\n"),
    );
    await writeFile(
      join(root, "evals/support.cases.jsonl"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "a-sidecar",
        input: { message: "sidecar" },
        metadata: {
          source: "review",
          reviewId: "review-1",
          runId: "run-1",
          addedAt: "2026-07-16T00:00:00.000Z",
        },
      })}\n`,
    );
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "import { config } from '@use-crux/core'",
        "import { genericQueue, inMemoryRuntimeStore, serverless } from '@use-crux/core/runtime'",
        "const memory = inMemoryRuntimeStore()",
        "const store = Object.freeze({ ...memory, id: 'capability-readiness-fixture' })",
        "export default config({ runtime: serverless({",
        "  store, namespace: 'capability-readiness', publicUrl: 'http://localhost',",
        "  wake: genericQueue({ secret: 'capability-readiness-secret-32-bytes', enqueue: async () => undefined }),",
        "}), observability: { redactPaths: ['customer.email'] } })",
      ].join("\n"),
    );
    const definitions = (
      await discoverRuntimeEvalDefinitions(root, ["**/*.eval.ts"], [])
    ).definitions satisfies readonly ProjectDefinition[];

    const result = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions,
    });
    const entry = await readFile(join(root, "crux.generated/next.ts"), "utf8");
    const privacy = JSON.parse(
      await readFile(
        join(root, ".crux/generated/runtime/privacy.json"),
        "utf8",
      ),
    );

    expect(result.manifest.evals).toEqual([
      expect.objectContaining({
        id: "support",
        module: "./evals/support.eval.ts",
        export: "default",
        cases: [
          expect.objectContaining({ id: "a-sidecar" }),
          expect.objectContaining({ id: "z-inline" }),
        ],
        variants: [
          expect.objectContaining({
            name: "current",
            execution: "runtime",
            requiredHostCapabilities: ["asset-store"],
          }),
        ],
        requiredHostCapabilities: ["asset-store"],
      }),
    ]);
    expect(result.manifest.version).toBe(2);
    expect(result.manifest.evalPrivacyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(privacy).toEqual({
      schemaVersion: 1,
      privacyFingerprint: result.manifest.evalPrivacyFingerprint,
      redactPaths: ["customer.email"],
    });
    expect(result.manifest.evals[0]!.evalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(entry).toContain("createDeployedEvalRegistry");
    expect(entry).toContain('redactPaths:["customer.email"]');
    expect(entry).toContain("createServerlessEvalHost");
    expect(entry).toContain("const supportedEvalHostCapabilities = []");
    expect(entry).toContain("hostCapabilities: evalHostCapabilities");
    expect(entry).toContain("CRUX_EVAL_HOST_DEPLOYMENT_ID");
    expect(entry).toContain("CRUX_EVAL_HOST_TOKEN");
    expect(entry).toContain("export const DELETE");
    expect(entry).toContain("import eval0 from '../evals/support.eval'");
    expect(entry).toContain('"a-sidecar"');
    expect(entry).toContain('"z-inline"');
    expect(entry).not.toMatch(
      /DO_NOT_SERIALIZE_(?:PROMPT|MODEL|CREDENTIAL)|function\s*\(|apiKey/,
    );

    const deploymentId = process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID;
    const token = process.env.CRUX_EVAL_HOST_TOKEN;
    process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID = "capability-readiness";
    process.env.CRUX_EVAL_HOST_TOKEN =
      "capability-readiness-token-at-least-32-bytes";
    try {
      const generated = (await importUserModule(
        join(root, "crux.generated/next.ts"),
        4_000,
      )) as {
        readonly GET: (request: Request) => Promise<Response>;
      };
      const response = await generated.GET(
        new Request("http://localhost/api/crux/manifest", {
          headers: {
            authorization:
              "Bearer capability-readiness-token-at-least-32-bytes",
          },
        }),
      );
      const responseText = await response.clone().text();
      await expect(response.json()).resolves.toMatchObject({
        privacyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        capabilities: ["result-ref"],
        evals: [
          expect.objectContaining({
            id: "support",
            requiredHostCapabilities: ["asset-store"],
          }),
        ],
      });
      expect(responseText).not.toContain("customer.email");
    } finally {
      if (deploymentId === undefined)
        delete process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID;
      else process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID = deploymentId;
      if (token === undefined) delete process.env.CRUX_EVAL_HOST_TOKEN;
      else process.env.CRUX_EVAL_HOST_TOKEN = token;
    }

    const indexMismatch = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions: [
        {
          ...definitions[0],
          metadata: {
            ...definitions[0]!.metadata,
            requiredHostCapabilities: [],
          },
        },
      ],
    }).catch((error: unknown) => error);
    expect(indexMismatch).toBeInstanceOf(Error);
    expect((indexMismatch as Error).message).toMatch(
      /Project Index capability facts disagree.*support/i,
    );
    expect((indexMismatch as Error & { cause?: unknown }).cause).toEqual([
      expect.any(TypeError),
    ]);

    await expect(
      generateRuntimeArtifacts({
        root,
        host: "next",
        definitions: [
          {
            ...definitions[0],
            metadata: {
              ...definitions[0]!.metadata,
              evalExecutionArms: [
                {
                  name: "renamed",
                  execution: "runtime",
                  requiredHostCapabilities: ["asset-store"],
                },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow(/Project Index arm facts disagree.*support/i);
  });

  it("keeps ordinary Next Runtime requests usable when Eval host secrets are absent", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
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
      join(root, "crux.config.ts"),
      [
        "import { config } from '@use-crux/core'",
        "import { genericQueue, inMemoryRuntimeStore, serverless } from '@use-crux/core/runtime'",
        "const memory = inMemoryRuntimeStore()",
        "const store = Object.freeze({ ...memory, id: 'durable-generated-fixture' })",
        "export default config({ runtime: serverless({",
        "  store, namespace: 'generated-fixture', publicUrl: 'http://localhost',",
        "  wake: genericQueue({ secret: 'generated-runtime-secret-32-bytes', enqueue: async (message) => { (globalThis as any).__generatedEvalWake = message } }),",
        "}) })",
      ].join("\n"),
    );
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "const localFixture = () => 'refund?'",
        "export default evaluate({ id: 'support', task: async (input: unknown) => input, cases: [{ id: 'refund', input: { resolve: localFixture } }] })",
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
    const result = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions,
    });
    const entry = await readFile(join(root, "crux.generated/next.ts"), "utf8");
    const generated = (await importUserModule(
      join(root, "crux.generated/next.ts"),
      4_000,
    )) as {
      readonly GET: (request: Request) => Promise<Response>;
    };

    expect(result.manifest.evals).toEqual([]);
    expect(entry).not.toContain("createServerlessEvalHost");
    expect(entry).not.toContain("evals/support.eval");
    await expect(
      generated.GET(new Request("http://localhost/api/crux")),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("imports only mixed Evals and deploys only their Runtime arms", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
    const coordinatorSource = join(root, "evals/coordinator.eval.ts");
    const mixedSource = join(root, "evals/mixed.eval.ts");
    await mkdir(dirname(coordinatorSource), { recursive: true });
    await writeFile(
      coordinatorSource,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "const nodeOnly = () => process.cwd()",
        "export default evaluate({ id: 'coordinator', task: async (input: unknown) => input, cases: [{ id: 'local', input: { nodeOnly } }] })",
      ].join("\n"),
    );
    await writeFile(
      mixedSource,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const hosted = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk', capabilities: [], requiredHostCapabilities: ['record-store'], overrideKeys: [], defaults: {},",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }), execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output, projectResponse: (() => ({})) as never,",
        "})",
        "export default evaluate({ id: 'mixed', task: async (input: unknown) => input, cases: [{ id: 'portable', input: { question: 'refund?' } }], variants: { hosted: { task: hosted } } })",
      ].join("\n"),
    );
    const definitions = (
      await discoverRuntimeEvalDefinitions(root, ["**/*.eval.ts"], [])
    ).definitions;

    const result = await generateRuntimeArtifacts({
      root,
      host: "convex",
      definitions,
    });
    const entry = await readFile(join(root, "convex/_crux/targets.ts"), "utf8");

    expect(result.manifest.evals).toEqual([
      expect.objectContaining({
        id: "mixed",
        variants: [
          expect.objectContaining({
            name: "current",
            execution: "coordinator",
          }),
          expect.objectContaining({
            name: "hosted",
            execution: "runtime",
            requiredHostCapabilities: ["record-store"],
          }),
        ],
      }),
    ]);
    expect(entry).toContain("evals/mixed.eval");
    expect(entry).toContain(
      '"runtimeArms":[{"name":"hosted","requiredHostCapabilities":["record-store"]}]',
    );
    expect(entry).not.toContain("evals/coordinator.eval");
  });

  it("adds Eval identity to Crux-owned deployment import failures", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
    const source = join(root, "evals/broken.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "throw new Error('native-import-boom')\n");
    const definitions = [
      {
        id: "eval:broken",
        kind: "eval",
        name: "broken",
        fidelity: "resolved",
        source: { file: source, line: 1 },
        metadata: {
          exportName: "default",
          evalContract: "crux.eval",
          evalExecutionArms: [
            {
              name: "current",
              execution: "runtime",
              requiredHostCapabilities: ["record-store"],
            },
          ],
        },
      },
    ] satisfies readonly ProjectDefinition[];

    await expect(
      generateRuntimeArtifacts({ root, host: "next", definitions }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "RUNTIME_EVAL_IMPORT_FAILED",
          featureId: "broken",
          source: "evals/broken.eval.ts",
          reason: expect.stringContaining("native-import-boom"),
        }),
      ],
    });
  });

  it("fails invalid or missing execution facts before Case hydration", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-registry-"));
    roots.push(root);
    const source = join(root, "evals/invalid.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "const localFixture = () => 'not deployable'",
        "export default evaluate({ id: 'invalid', task: 42 as never, cases: [{ id: 'local', input: { localFixture } }] })",
      ].join("\n"),
    );
    const definition = (
      await discoverRuntimeEvalDefinitions(root, ["**/*.eval.ts"], [])
    ).definitions[0]!;

    expect(definition.metadata?.evalExecutionArms).toEqual([
      expect.objectContaining({
        name: "current",
        status: "invalid",
        code: "task_not_callable",
      }),
    ]);
    await expect(
      generateRuntimeArtifacts({
        root,
        host: "next",
        definitions: [definition],
      }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "RUNTIME_EVAL_INVALID",
          featureId: "invalid",
          arm: "current",
          reason: expect.stringMatching(/callable/i),
        }),
      ],
    });
    await expect(
      readFile(join(root, ".crux/generated/runtime/manifest.json"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const { evalExecutionArms: _arms, ...metadataWithoutArms } =
      definition.metadata!;
    await expect(
      generateRuntimeArtifacts({
        root,
        host: "next",
        definitions: [
          { ...definition, metadata: metadataWithoutArms },
        ] satisfies readonly ProjectDefinition[],
      }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "RUNTIME_EVAL_INDEX_FACTS_INVALID",
          featureId: "invalid",
          category: "internal",
        }),
      ],
    });
    await expect(
      generateRuntimeArtifacts({
        root,
        host: "next",
        definitions: [
          {
            ...definition,
            metadata: { ...definition.metadata, evalExecutionArms: [{}] },
          },
        ],
      }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "RUNTIME_EVAL_INDEX_FACTS_INVALID",
          featureId: "invalid",
          category: "internal",
        }),
      ],
    });

    const packageSkew = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions: [
        {
          ...definition,
          metadata: {
            ...definition.metadata,
            evalExecutionArms: [
              {
                name: "current",
                status: "invalid",
                code: "task_contract_incompatible",
                reason: "Managed Eval task descriptor is incompatible.",
              },
            ],
          },
        },
      ],
    }).catch((error: unknown) => error);
    expect(packageSkew).toMatchObject({
      findings: [
        expect.objectContaining({
          code: "RUNTIME_EVAL_TASK_CONTRACT_INCOMPATIBLE",
          category: "configuration",
          reason: expect.stringMatching(/packages.*task contract/i),
        }),
      ],
    });
    expect(packageSkew).toBeInstanceOf(Error);
    expect((packageSkew as Error).message).not.toMatch(
      /descriptor|opaque|placement|eligibility/i,
    );
  });
});
