import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import { generateRuntimeArtifacts } from "../../src/indexer/runtime-artifacts";

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
    const definitions = [
      {
        id: "evaluation:support",
        kind: "evaluation",
        name: "support",
        fidelity: "resolved",
        source: { file: source, line: 1 },
        metadata: {
          exportName: "default",
          evalContract: "crux.eval",
          requiredHostCapabilities: ["asset-store"],
        },
      },
    ] satisfies readonly ProjectDefinition[];

    const result = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions,
    });
    const entry = await readFile(join(root, "crux.generated/next.ts"), "utf8");

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
    expect(result.manifest.evals[0]!.evalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(entry).toContain("createDeployedEvalRegistry");
    expect(entry).toContain("import eval0 from '../evals/support.eval'");
    expect(entry).toContain('"a-sidecar"');
    expect(entry).toContain('"z-inline"');
    expect(entry).not.toMatch(
      /DO_NOT_SERIALIZE_(?:PROMPT|MODEL|CREDENTIAL)|function\s*\(|apiKey/,
    );

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
});
