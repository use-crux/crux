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
        variants: [expect.objectContaining({ name: "current" })],
        requiredHostCapabilities: ["asset-store"],
      }),
    ]);
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
      )) as { readonly GET: (request: Request) => Promise<Response> };
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

    await expect(
      generateRuntimeArtifacts({
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
      }),
    ).rejects.toThrow(/Project Index capability facts disagree.*support/i);
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
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "import { createCruxSpanId, createCruxTraceId } from '@use-crux/core/observability'",
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk', capabilities: [], requiredHostCapabilities: [], overrideKeys: [], defaults: {},",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }), execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => ({ runId: 'run_generated', _meta: { traceId: createCruxTraceId(), spanId: createCruxSpanId() }, content: [], text: JSON.stringify(result.output), steps: [], finalStep: { content: [], text: JSON.stringify(result.output), finishReason: 'stop', responseId: 'generated', modelId: 'fixture', warnings: [] }, messages: [], warnings: [] }),",
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
    await generateRuntimeArtifacts({ root, host: "next", definitions });
    const deploymentId = process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID;
    const token = process.env.CRUX_EVAL_HOST_TOKEN;
    delete process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID;
    delete process.env.CRUX_EVAL_HOST_TOKEN;
    try {
      const generated = (await importUserModule(
        join(root, "crux.generated/next.ts"),
        4_000,
      )) as {
        readonly GET: (request: Request) => Promise<Response>;
        readonly POST: (request: Request) => Promise<Response>;
      };
      const health = await generated.GET(
        new Request("http://localhost/api/crux"),
      );
      const manifest = await generated.GET(
        new Request("http://localhost/api/crux/manifest"),
      );

      expect(health.status).toBe(200);
      expect(manifest.status).toBe(503);
      await expect(manifest.json()).resolves.toMatchObject({
        error: {
          code: "EVAL_HOST_SETUP_REQUIRED",
          message: expect.stringContaining("CRUX_EVAL_HOST_DEPLOYMENT_ID"),
        },
      });
      process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID = "generated-fixture";
      process.env.CRUX_EVAL_HOST_TOKEN =
        "generated-eval-host-token-at-least-32-bytes";
      const ready = await generated.GET(
        new Request("http://localhost/api/crux/manifest", {
          headers: {
            authorization: "Bearer generated-eval-host-token-at-least-32-bytes",
          },
        }),
      );
      expect(ready.status).toBe(200);
      const deployed = (await ready.json()) as {
        protocol: "crux.eval-host.v1";
        evals: readonly {
          id: string;
          evalFingerprint: string;
          cases: Readonly<Record<string, string>>;
          variants: Readonly<Record<string, string>>;
        }[];
      };
      expect(deployed).toMatchObject({
        deploymentId: "generated-fixture",
        evals: [expect.objectContaining({ id: "support" })],
      });
      const support = deployed.evals[0]!;
      const job = {
        protocol: deployed.protocol,
        jobId: "generated-next-refund",
        evalRunId: "generated-next-run",
        evalId: support.id,
        evalFingerprint: support.evalFingerprint,
        caseId: "refund",
        caseFingerprint: support.cases.refund!,
        variant: "current",
        variantFingerprint: support.variants.current!,
        trial: 0,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const accepted = await generated.POST(
        new Request("http://localhost/api/crux/jobs", {
          method: "POST",
          headers: {
            authorization: "Bearer generated-eval-host-token-at-least-32-bytes",
            "content-type": "application/json",
          },
          body: JSON.stringify(job),
        }),
      );
      expect(accepted.status).toBe(202);
      const wake = (
        globalThis as typeof globalThis & {
          __generatedEvalWake?: {
            readonly body: string;
            readonly headers: Readonly<Record<string, string>>;
          };
        }
      ).__generatedEvalWake;
      expect(wake).toBeDefined();
      const delivered = await generated.POST(
        new Request("http://localhost/api/crux", {
          method: "POST",
          headers: wake!.headers,
          body: wake!.body,
        }),
      );
      expect(delivered.status).toBe(200);
      const completed = await generated.GET(
        new Request(`http://localhost/api/crux/jobs/${job.jobId}`, {
          headers: {
            authorization: "Bearer generated-eval-host-token-at-least-32-bytes",
          },
        }),
      );
      expect(completed.status).toBe(200);
      const completedBody = await completed.json();
      expect(completedBody).toMatchObject({
        status: "succeeded",
        jobId: job.jobId,
        result: { output: { question: "refund?" } },
      });
    } finally {
      delete (
        globalThis as typeof globalThis & { __generatedEvalWake?: unknown }
      ).__generatedEvalWake;
      if (deploymentId === undefined)
        delete process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID;
      else process.env.CRUX_EVAL_HOST_DEPLOYMENT_ID = deploymentId;
      if (token === undefined) delete process.env.CRUX_EVAL_HOST_TOKEN;
      else process.env.CRUX_EVAL_HOST_TOKEN = token;
    }
  });
});
