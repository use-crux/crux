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
      version: 1,
      targets: [],
      evals: [],
    });
    expect(second.contentHash).toBe(result.contentHash);
    await expect(
      readFile(join(root, ".crux/generated/runtime/manifest.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(result.manifest, null, 2)}\n`);
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toContain("createRuntimeHandler({ targets, manifestHash:");
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
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toContain(
      "import { reviewFlow as target0 } from '../src/review'",
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
    expect(first.writtenFiles).toContain(join(root, "crux.generated/next.ts"));
    expect(second.writtenFiles).toEqual([]);
  });

  it("does not infer Convex host from commented config source", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "import { config } from '@use-crux/core'",
        "import { node } from '@use-crux/core/runtime'",
        "",
        "// runtime: convex()",
        "export default config({ runtime: node() })",
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
      code: "SETUP_REQUIRED",
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
      code: "ARTIFACTS_STALE",
    });
    await expect(
      readFile(join(root, "crux.generated/next.ts"), "utf8"),
    ).resolves.toBe("export const userAuthored = true\n");
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
      manifest: { version: 1, targets: [] },
    });
  });

  it("reports non-terminal runtime work whose target disappeared from the manifest", () => {
    const drift = diffRuntimeArtifactDrift({
      manifest: {
        version: 1,
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
