import { expect, it } from "vitest";

type RunCoordinator = (
  args: readonly string[],
) => Promise<{ readonly code: number; readonly events: readonly unknown[]; readonly stderr: string }>;

const evalPolicy = {
  totalMs: 30_000,
  stepMs: 5_000,
  firstToken: null,
  toolMs: 10_000,
  tools: { archive: 4_000, search: 2_500 },
} as const;

/** Register the coordinator's canonical Eval catalog timeout contract test. */
export function registerEvalCatalogTimeoutBehavior(run: RunCoordinator): void {
  it("projects canonical Eval and hydrated Case timeout policies", async () => {
    const result = await run(["--list"]);
    expect(result.code, result.stderr).toBe(0);

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "collect:done",
          evals: expect.arrayContaining([
            expect.objectContaining({
              id: "timeouts",
              timeout: { authored: evalPolicy, effective: evalPolicy },
              cases: [
                {
                  id: "inherited",
                  origin: "evals/timeouts.eval.ts:inline:1",
                  timeout: { effective: evalPolicy },
                },
                {
                  id: "partial",
                  origin: "evals/timeouts.eval.ts:inline:2",
                  timeout: {
                    authored: { stepMs: 1_500 },
                    effective: { ...evalPolicy, stepMs: 1_500 },
                  },
                },
                {
                  id: "tool-clear",
                  origin: "evals/timeouts.eval.ts:inline:3",
                  timeout: {
                    authored: { tools: { search: null } },
                    effective: {
                      ...evalPolicy,
                      tools: { archive: 4_000, search: null },
                    },
                  },
                },
                {
                  id: "whole-clear",
                  origin: "evals/timeouts.eval.ts:inline:4",
                  timeout: {
                    authored: null,
                    effective: {
                      totalMs: null,
                      stepMs: null,
                      firstToken: null,
                      toolMs: null,
                      tools: { archive: null, search: null },
                    },
                  },
                },
                {
                  id: "file-backed",
                  origin: "evals/fixtures/timeouts.json:1",
                  timeout: {
                    authored: {
                      chunkMs: 750,
                      tools: { archive: null },
                    },
                    effective: {
                      ...evalPolicy,
                      chunkMs: 750,
                      tools: { archive: null, search: 2_500 },
                    },
                  },
                },
              ],
            }),
          ]),
        }),
      ]),
    );
  });
}
