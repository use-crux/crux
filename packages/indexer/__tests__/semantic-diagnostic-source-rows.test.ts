import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSemanticIndexService,
  type SemanticBackend,
} from "../src/indexer/semantic/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic diagnostic source rows", () => {
  it("groups projected PromptText diagnostic ids by their actual source file", async () => {
    const root = await mkdtemp(
      join(process.cwd(), ".tmp-semantic-diagnostic-sources-"),
    );
    roots.push(root);
    const file = join(root, "src/prompt.ts");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(file, "export const prompt = true");

    const backend: SemanticBackend<"diagnostic-source-test"> = {
      identity: { name: "diagnostic-source-test", version: "v1" },
      capabilities: {
        apiStability: "stable",
        factProduction: "complete",
        sessionReuse: "none",
        transport: "in-process",
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze() {
            yield {
              kind: "diagnostics",
              facts: [
                {
                  id: "prompt-text:invalid",
                  severity: "error",
                  code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
                  message: "invalid",
                  source: { file, line: 1, column: 23 },
                  evidence: {
                    kind: "prompt-text",
                    sourceRefId: "prompt:writer:source:prompt",
                    interpolationIndex: 0,
                    proof: "semantic-exact",
                    cause: {
                      kind: "invalid-interpolation",
                      runtimeKinds: ["boolean"],
                    },
                  },
                },
              ],
            };
          },
        };
      },
    };

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [file],
    });

    expect(patch.facts.sources).toEqual([
      {
        file,
        status: "error",
        definitionIds: [],
        dependencies: [],
        dependents: [],
        diagnostics: ["prompt-text:invalid"],
      },
    ]);
  });
});
