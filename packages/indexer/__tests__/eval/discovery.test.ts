import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeEvalDefinitions } from "../../src/indexer/eval-discovery";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Eval Project Index discovery", () => {
  it("emits managed host requirements from the discovered default Eval", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/support.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'fixture',",
        "  capabilities: [], requiredHostCapabilities: ['record-store'], defaults: {}, overrideKeys: [],",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: { fixture: true } }),",
        "  execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => result.output,",
        "})",
        "export default evaluate({ id: 'support', task, cases: [{ input: {} }] })",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.definitions).toContainEqual(
      expect.objectContaining({
        id: "eval:support",
        kind: "eval",
        name: "support",
        source: expect.objectContaining({ file: source }),
        metadata: expect.objectContaining({
          exportName: "default",
          evalContract: "crux.eval",
          requiredHostCapabilities: ["record-store"],
        }),
      }),
    );
  });
});
