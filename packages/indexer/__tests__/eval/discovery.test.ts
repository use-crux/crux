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
  it("emits safe default-export corroboration without inspecting private code", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/support.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "const task = Object.assign(async (input: unknown) => input, { __evalTypes: undefined as never })",
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
        id: "evaluation:support",
        kind: "evaluation",
        name: "support",
        source: expect.objectContaining({ file: source }),
        metadata: expect.objectContaining({
          exportName: "default",
          evalContract: "crux.eval",
          requiredHostCapabilities: [],
        }),
      }),
    );
  });
});
