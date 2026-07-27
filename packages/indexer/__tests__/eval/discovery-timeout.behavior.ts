import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { discoverRuntimeEvalDefinitions } from "../../src/indexer/eval-discovery";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function evalTimeoutDiscoveryBehavior(): void {
  it("projects canonical Eval timeout policy into runtime-rich facts and identity", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-timeout-"));
    const configuredSource = join(root, "evals/configured.eval.ts");
    const clearedSource = join(root, "evals/cleared.eval.ts");

    try {
      await mkdir(dirname(configuredSource), { recursive: true });
      await writeEval(configuredSource, [
        "id: 'configured',",
        "task: async (input: string) => input,",
        "cases: [{ input: 'hello' }],",
      ]);
      const before = await discoverRuntimeEvalDefinitions(
        root,
        ["**/*.eval.ts"],
        [],
      );
      const beforeDefinition = before.definitions.find(
        ({ id }) => id === "eval:configured",
      );
      expect(beforeDefinition?.metadata).not.toHaveProperty("timeout");

      await writeEval(configuredSource, [
        "id: 'configured',",
        "task: async (input: string) => input,",
        "timeout: {",
        "  totalMs: 30_000.9,",
        "  stepMs: -1,",
        "  firstToken: null,",
        "  tools: { search: 750.8, archive: null },",
        "},",
        "cases: [{ input: 'hello' }],",
      ]);
      await writeEval(clearedSource, [
        "id: 'cleared',",
        "task: async (input: string) => input,",
        "timeout: null,",
        "cases: [{ input: 'hello' }],",
      ]);
      const after = await discoverRuntimeEvalDefinitions(
        root,
        ["**/*.eval.ts"],
        [],
      );
      const configured = after.definitions.find(
        ({ id }) => id === "eval:configured",
      );
      const cleared = after.definitions.find(
        ({ id }) => id === "eval:cleared",
      );
      const configuredTimeout = {
        authored: {
          totalMs: 30_000,
          stepMs: null,
          firstToken: null,
          tools: { archive: null, search: 750 },
        },
        effective: {
          totalMs: 30_000,
          stepMs: null,
          firstToken: null,
          tools: { archive: null, search: 750 },
        },
      };

      expect(configured?.metadata).toMatchObject({
        timeout: configuredTimeout,
        facts: { timeout: configuredTimeout },
      });
      expect(cleared?.metadata).toMatchObject({
        timeout: { authored: null, effective: {} },
        facts: { timeout: { authored: null, effective: {} } },
      });
      expect(configured?.fingerprint).not.toBe(beforeDefinition?.fingerprint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

async function writeEval(file: string, fields: readonly string[]): Promise<void> {
  await writeFile(
    file,
    [
      "import { evaluate } from '@use-crux/core/eval'",
      "export default evaluate({",
      ...fields.map((field) => `  ${field}`),
      "})",
    ].join("\n"),
  );
}
