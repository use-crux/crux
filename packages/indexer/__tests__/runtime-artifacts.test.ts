import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffRuntimeArtifactDrift,
  generateRuntimeArtifacts,
} from "../src/indexer/runtime-artifacts";

const roots: string[] = [];
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(testWorkspaceRoot, ".tmp-runtime-artifacts-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime artifacts", () => {
  it("writes deterministic empty Next artifacts when no targets or Evals are discovered", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "import { task } from '@use-crux/core/runtime'",
        "",
        "export const reviewFlow = flow('review', async (flow) => {",
        "  await flow.suspend('approved')",
        "})",
        "",
        "export const embedDocument = task('embed-document', {",
        "  run: async () => undefined,",
        "})",
      ].join("\n"),
    );

    const result = await generateRuntimeArtifacts({ root, host: "next" });
    const second = await generateRuntimeArtifacts({ root, host: "next" });

    expect(result.manifest).toEqual({
      version: 2,
      evalPrivacyFingerprint:
        "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
      targets: [],
      evals: [],
    });
    expect(second.contentHash).toBe(result.contentHash);
    await expect(
      readFile(join(root, ".crux/generated/runtime/manifest.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(result.manifest, null, 2)}\n`);
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toContain(
      "createRuntimeHandler({ targets: runtimeProgram.targets, manifestHash: runtimeProgram.manifestHash })",
    );
    const entry = await readFile(join(root, "crux.generated/next.ts"), "utf8");
    expect(entry).toContain("export const evalRegistry");
    expect(entry).toContain("entries:[]");
    expect(entry).not.toContain("supportedEvalHostCapabilities");
    expect(entry).not.toContain("evalHostCapabilities");
    await expect(
      readFile(join(root, "convex/crux.ts"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("projects supplied Project Index definitions into runtime artifacts", async () => {
    const root = await fixtureRoot();
    const sourceFile = join(root, "src/review.ts");
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(
      sourceFile,
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    const definitions = [
      {
        id: "flow:review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        source: { file: sourceFile, line: 1 },
        metadata: { exportName: "reviewFlow" },
      },
    ] satisfies readonly ProjectDefinition[];

    const result = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions,
    });

    expect(result.manifest.targets).toEqual([
      {
        name: "review",
        kind: "flow",
        module: "./src/review.ts",
        export: "reviewFlow",
      },
    ]);
    await expect(
      readFile(join(root, ".crux/generated/runtime/program.ts"), "utf8"),
    ).resolves.toContain(
      "import { reviewFlow as target0 } from '../../../src/review'",
    );
    await expect(
      readFile(join(root, ".crux/generated/runtime/program.ts"), "utf8"),
    ).resolves.toContain("createRuntimeProgram({ targets, transports })");
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toContain(
      "import { runtimeProgram } from '../.crux/generated/runtime/program'",
    );
  });

  it("writes split Convex entry files without a top-level shim", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "export default {",
        "  config: { runtime: { kind: 'host-bound', host: 'convex', id: 'convex', capabilities: {} } },",
        "  prompts: [],",
        "  contexts: [],",
        "  get() { return undefined },",
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    const result = await generateRuntimeArtifacts({ root });

    expect(result.writtenFiles).toContain(
      join(root, "convex/_crux/generated.ts"),
    );
    expect(result.writtenFiles).toContain(
      join(root, "convex/_crux/targets.ts"),
    );
    expect(result.writtenFiles).toContain(join(root, "convex/_crux/http.ts"));
    expect(result.writtenFiles).toContain(join(root, "convex/http.ts"));
    expect(result.writtenFiles).not.toContain(
      join(root, "crux.generated/next.ts"),
    );
    await expect(
      readFile(join(root, "convex/crux.ts"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const control = await readFile(
      join(root, "convex/_crux/generated.ts"),
      "utf8",
    );
    const targets = await readFile(
      join(root, "convex/_crux/targets.ts"),
      "utf8",
    );
    const http = await readFile(join(root, "convex/http.ts"), "utf8");
    const httpRoutes = await readFile(
      join(root, "convex/_crux/http.ts"),
      "utf8",
    );
    expect(control).toContain("This file is generated by Crux. Do not edit.");
    expect(control).toContain("makeFunctionReference<'action'");
    expect(control).toContain("_crux/targets:executeTarget");
    expect(control).toContain("targetExecutor");
    expect(control).not.toContain("from '../../src/review'");
    expect(targets).toContain("'use node'");
    expect(targets).toContain("createConvexRuntimeTargetExecutor");
    expect(targets).toContain("createConvexEvalHost");
    expect(targets).toContain("from '@use-crux/convex/runtime/node'");
    expect(targets).not.toContain("from '../../src/review'");
    expect(targets).toContain("executeTarget");
    expect(targets).toContain("handleEvalRequest");
    expect(targets).toContain("executeEvalTarget");
    expect(targets).toContain("CRUX_EVAL_HOST_TOKEN");
    expect(targets).toContain("CONVEX_CLOUD_URL");
    expect(targets).not.toContain("CONVEX_DEPLOYMENT");
    expect(targets).not.toContain("if (!evalHostToken)");
    expect(targets).toContain("token: evalHostToken");
    expect(targets).toContain(
      "const supportedEvalHostCapabilities = ['record-store', 'vector-store']",
    );
    expect(targets).toContain("hostCapabilities: evalHostCapabilities");
    expect(http).toContain("import { httpRouter } from 'convex/server'");
    expect(http).toContain(
      "import { registerCruxEvalRoutes } from './_crux/http'",
    );
    expect(http).toContain("registerCruxEvalRoutes(httpRouter())");
    expect(http).toContain("export default http");
    expect(httpRoutes).toContain(
      "import { createConvexEvalHttpAction } from '@use-crux/convex/runtime'",
    );
    expect(httpRoutes).toContain(
      "const handler = createConvexEvalHttpAction()",
    );
    expect(httpRoutes).not.toContain("from './targets'");
    expect(httpRoutes).not.toContain("../_generated/api");
    expect(httpRoutes.match(/http\.route\(/g)).toHaveLength(4);
    expect(httpRoutes).toContain("path: '/manifest'");
    expect(httpRoutes).toContain("path: '/jobs'");
    expect(httpRoutes).toContain("pathPrefix: '/jobs/'");
    expect(httpRoutes).toContain("method: 'DELETE'");
  });

  it("does not rewrite byte-identical generated artifacts", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    const first = await generateRuntimeArtifacts({ root, host: "next" });
    const second = await generateRuntimeArtifacts({ root, host: "next" });

    expect(first.writtenFiles).toContain(
      join(root, ".crux/generated/runtime/manifest.json"),
    );
    expect(first.writtenFiles).toContain(
      join(root, ".crux/generated/runtime/program.ts"),
    );
    expect(first.writtenFiles).toContain(join(root, "crux.generated/next.ts"));
    expect(second.writtenFiles).toEqual([]);
  });

  it("does not infer Convex host from commented config source", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "import { node } from '@use-crux/core/runtime'",
        "",
        "// runtime: convex()",
        "export default {",
        "  config: { runtime: node() },",
        "  prompts: [],",
        "  contexts: [],",
        "  get() { return undefined },",
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    const result = await generateRuntimeArtifacts({ root });

    expect(result.writtenFiles).toContain(join(root, "crux.generated/next.ts"));
    expect(result.writtenFiles).not.toContain(
      join(root, "convex/_crux/generated.ts"),
    );
    expect(result.writtenFiles).not.toContain(
      join(root, "convex/_crux/targets.ts"),
    );
    expect(result.writtenFiles).not.toContain(join(root, "convex/crux.ts"));
  }, 30_000);

  it("regenerates byte-identical artifacts across process locale settings", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "import { task } from '@use-crux/core/runtime'",
        "",
        "export const zeta = flow('zeta', async () => undefined)",
        "export const alpha = task('alpha', { run: async () => undefined })",
      ].join("\n"),
    );
    const previousLang = process.env.LANG;
    try {
      process.env.LANG = "C";
      await generateRuntimeArtifacts({ root, host: "next" });
      const cManifest = await readFile(
        join(root, ".crux/generated/runtime/manifest.json"),
        "utf8",
      );
      const cEntry = await readFile(
        join(root, "crux.generated/next.ts"),
        "utf8",
      );

      process.env.LANG = "en_US.UTF-8";
      await generateRuntimeArtifacts({ root, host: "next" });
      await expect(
        readFile(join(root, ".crux/generated/runtime/manifest.json"), "utf8"),
      ).resolves.toBe(cManifest);
      await expect(
        readFile(join(root, "crux.generated/next.ts"), "utf8"),
      ).resolves.toBe(cEntry);
    } finally {
      if (previousLang === undefined) delete process.env.LANG;
      else process.env.LANG = previousLang;
    }
  });

  it("fails loudly when a present config cannot resolve a runtime host", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "crux.config.ts"),
      'export default { runtime: "convex" }\n',
    );
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    await expect(generateRuntimeArtifacts({ root })).rejects.toMatchObject({
      code: "RUNTIME_ARTIFACT_GENERATION_FAILED",
      findings: [expect.objectContaining({ code: "SETUP_REQUIRED" })],
    });
  });

  it("refuses to overwrite user-authored entry files without the generated marker", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "crux.generated"), { recursive: true });
    await writeFile(
      join(root, "crux.generated/next.ts"),
      "export const userAuthored = true\n",
    );
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    await expect(
      generateRuntimeArtifacts({ root, host: "next" }),
    ).rejects.toMatchObject({
      code: "RUNTIME_ARTIFACT_GENERATION_FAILED",
      findings: [expect.objectContaining({ code: "ARTIFACTS_STALE" })],
    });
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toBe("export const userAuthored = true\n");
  });

  it("preserves an existing Convex router without writing sibling artifacts", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "convex"), { recursive: true });
    await writeFile(
      join(root, "convex/http.ts"),
      "export default { userAuthored: true }\n",
    );

    await expect(
      generateRuntimeArtifacts({ root, host: "convex" }),
    ).rejects.toThrow(/registerCruxEvalRoutes.*\.\/_crux\/http/i);
    await expect(readFile(join(root, "convex/http.ts"), "utf8")).resolves.toBe(
      "export default { userAuthored: true }\n",
    );
    await expect(
      readFile(join(root, "convex/_crux/http.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an existing Convex router that registers the Crux bridge", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "convex"), { recursive: true });
    const router = [
      "import { httpRouter } from 'convex/server'",
      "import cruxConfig from '../crux.config'",
      "import { crux } from './_lib/cruxProfile'",
      "",
      "const http = httpRouter()",
      "crux.bridge(http, cruxConfig)",
      "export default http",
      "",
    ].join("\n");
    await writeFile(join(root, "convex/http.ts"), router);

    const first = await generateRuntimeArtifacts({ root, host: "convex" });
    const second = await generateRuntimeArtifacts({ root, host: "convex" });

    expect(first.writtenFiles).not.toContain(join(root, "convex/http.ts"));
    expect(first.writtenFiles).toContain(join(root, "convex/_crux/http.ts"));
    expect(second.writtenFiles).toEqual([]);
    await expect(readFile(join(root, "convex/http.ts"), "utf8")).resolves.toBe(
      router,
    );
  });

  it.each([
    "// crux.bridge(http, cruxConfig)\nexport default {}\n",
    "const note = 'crux.bridge(http, cruxConfig)'\nexport default {}\n",
  ])(
    "does not mistake bridge text for a compatible Convex router",
    async (router) => {
      const root = await fixtureRoot();
      await mkdir(join(root, "convex"), { recursive: true });
      await writeFile(join(root, "convex/http.ts"), router);

      await expect(
        generateRuntimeArtifacts({ root, host: "convex" }),
      ).rejects.toMatchObject({
        code: "RUNTIME_ARTIFACT_GENERATION_FAILED",
        findings: [expect.objectContaining({ code: "ARTIFACTS_STALE" })],
      });
      await expect(
        readFile(join(root, "convex/http.ts"), "utf8"),
      ).resolves.toBe(router);
    },
  );

  it("leaves every artifact byte-identical when the final protected destination conflicts", async () => {
    const root = await fixtureRoot();
    await generateRuntimeArtifacts({ root, host: "convex" });

    const sourceFile = join(root, "src/review.ts");
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(
      sourceFile,
      [
        "import { flow } from '@use-crux/core/flow'",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );
    const definitions = [
      {
        id: "flow:review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        source: { file: sourceFile, line: 1 },
        metadata: { exportName: "reviewFlow" },
      },
    ] satisfies readonly ProjectDefinition[];
    const conflictFile = join(root, "convex/http.ts");
    await writeFile(conflictFile, "export default { userAuthored: true }\n");

    const artifactFiles = [
      join(root, ".crux/generated/runtime/manifest.json"),
      join(root, ".crux/generated/runtime/privacy.json"),
      join(root, ".crux/generated/runtime/program.ts"),
      join(root, "convex/_crux/generated.ts"),
      join(root, "convex/_crux/targets.ts"),
      join(root, "convex/_crux/http.ts"),
      conflictFile,
    ];
    const before = await Promise.all(
      artifactFiles.map((file) => readFile(file, "utf8")),
    );

    await expect(
      generateRuntimeArtifacts({
        root,
        host: "convex",
        definitions,
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_ARTIFACT_GENERATION_FAILED",
      findings: [expect.objectContaining({ code: "ARTIFACTS_STALE" })],
    });

    await expect(
      Promise.all(artifactFiles.map((file) => readFile(file, "utf8"))),
    ).resolves.toEqual(before);
  });

  it("reports every protected conflict in stable path order without writing", async () => {
    const root = await fixtureRoot();
    const first = join(root, "convex/_crux/generated.ts");
    const second = join(root, "convex/http.ts");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "export const userControl = true\n");
    await writeFile(second, "export const userRouter = true\n");

    await expect(
      generateRuntimeArtifacts({ root, host: "convex" }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "ARTIFACTS_STALE",
          source: "convex/_crux/generated.ts",
        }),
        expect.objectContaining({
          code: "ARTIFACTS_STALE",
          source: "convex/http.ts",
        }),
      ],
    });
    await expect(readFile(first, "utf8")).resolves.toBe(
      "export const userControl = true\n",
    );
    await expect(readFile(second, "utf8")).resolves.toBe(
      "export const userRouter = true\n",
    );
    await expect(
      readFile(join(root, ".crux/generated/runtime/manifest.json"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("aggregates independent Eval and target failures in stable source order", async () => {
    const root = await fixtureRoot();
    const targetSource = join(root, "src/review.ts");
    await mkdir(dirname(targetSource), { recursive: true });
    await writeFile(targetSource, "export const differentName = true\n");
    const definitions = [
      {
        id: "flow:review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        source: { file: targetSource, line: 1 },
        metadata: { exportName: "reviewFlow" },
      },
      {
        id: "eval:invalid",
        kind: "eval",
        name: "invalid",
        fidelity: "resolved",
        source: { file: join(root, "evals/invalid.eval.ts"), line: 1 },
        metadata: {
          exportName: "default",
          evalContract: "crux.eval",
          runtimeDiscovered: true,
          evalExecutionArms: [
            {
              name: "current",
              status: "invalid",
              code: "task_not_callable",
              reason: "Eval task must be callable.",
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
          code: "RUNTIME_EVAL_INVALID",
          source: "evals/invalid.eval.ts",
        }),
        expect.objectContaining({
          code: "TARGET_NOT_EXPORTED",
          source: "src/review.ts",
        }),
      ],
    });
  });

  it("retains every deterministic failure within the Eval planning branch", async () => {
    const root = await fixtureRoot();
    const brokenSource = join(root, "evals/z-broken.eval.ts");
    await mkdir(dirname(brokenSource), { recursive: true });
    await writeFile(brokenSource, "throw new Error('broken Eval module')\n");
    const definitions = [
      {
        id: "eval:a-invalid",
        kind: "eval",
        name: "a-invalid",
        fidelity: "resolved",
        source: { file: join(root, "evals/a-invalid.eval.ts"), line: 1 },
        metadata: {
          exportName: "default",
          evalContract: "crux.eval",
          runtimeDiscovered: true,
          evalExecutionArms: [
            {
              name: "current",
              status: "invalid",
              code: "task_not_callable",
              reason: "Eval task must be callable.",
            },
          ],
        },
      },
      {
        id: "eval:z-broken",
        kind: "eval",
        name: "z-broken",
        fidelity: "resolved",
        source: { file: brokenSource, line: 1 },
        metadata: {
          exportName: "default",
          evalContract: "crux.eval",
          runtimeDiscovered: true,
          evalExecutionArms: [
            {
              name: "current",
              execution: "runtime",
              requiredHostCapabilities: [],
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
          code: "RUNTIME_EVAL_INVALID",
          featureId: "a-invalid",
        }),
        expect.objectContaining({
          code: "RUNTIME_EVAL_IMPORT_FAILED",
          featureId: "z-broken",
        }),
      ],
    });
  });

  it("retains duplicate and export failures within target planning", async () => {
    const root = await fixtureRoot();
    const source = join(root, "src/targets.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "export const unrelated = true\n");
    const definitions = [
      {
        id: "flow:first-review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        source: { file: source, line: 1 },
        metadata: { exportName: "firstReview" },
      },
      {
        id: "flow:second-review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        source: { file: source, line: 2 },
        metadata: { exportName: "secondReview" },
      },
    ] satisfies readonly ProjectDefinition[];

    await expect(
      generateRuntimeArtifacts({ root, host: "next", definitions }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: "TARGET_NOT_EXPORTED",
          featureId: "firstReview",
        }),
        expect.objectContaining({
          code: "TARGET_DUPLICATE",
          featureId: "review",
        }),
        expect.objectContaining({
          code: "TARGET_NOT_EXPORTED",
          featureId: "secondReview",
        }),
      ],
    });
  });

  it("overwrites entry files with the legacy generated marker during upgrades", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "crux.generated"), { recursive: true });
    await writeFile(
      join(root, "crux.generated/next.ts"),
      [
        "/* This file is generated by Crux. Do not edit by hand. */",
        "export const oldGeneratedEntry = true",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "export const reviewFlow = flow('review', async () => undefined)",
      ].join("\n"),
    );

    const result = await generateRuntimeArtifacts({ root, host: "next" });

    expect(result.writtenFiles).toContain(join(root, "crux.generated/next.ts"));
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toContain(
      "It will be overwritten by `crux runtime generate` and `crux dev`.",
    );
  });

  it("ignores source-only runtime targets when no native project index is supplied", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/review.ts"),
      [
        "import { flow } from '@use-crux/core/flow'",
        "",
        "const reviewFlow = flow('review', async () => undefined)",
        "export default reviewFlow",
      ].join("\n"),
    );

    await expect(
      generateRuntimeArtifacts({ root, host: "next" }),
    ).resolves.toMatchObject({
      manifest: { version: 2, targets: [] },
    });
  });

  it("reports non-terminal runtime work whose target disappeared from the manifest", () => {
    const drift = diffRuntimeArtifactDrift({
      manifest: {
        version: 2,
        evalPrivacyFingerprint:
          "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
        targets: [
          {
            name: "review",
            kind: "flow",
            module: "./src/review.ts",
            export: "reviewFlow",
          },
        ],
        evals: [],
      },
      nonTerminalTargetIds: [
        "review",
        "old-review",
        "old-review",
        "embed-document",
      ],
    });

    expect(drift.missingTargets).toEqual([
      { targetId: "embed-document", count: 1 },
      { targetId: "old-review", count: 2 },
    ]);
  });
});
