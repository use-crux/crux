import { expect, it } from "vitest";

import { createNodeEvalHostReadiness } from "../../../src/eval/node/host/readiness";
import { connectionEnvironment, hydratedEntry, manifest } from "./fixture";

/** Register deployed-readiness behavior owned by timeout identity. */
export function defineTimeoutReadinessBehavior(): void {
  it("rejects a deployment whose Case identity predates the Eval timeout policy", async () => {
    const deployedEntry = hydratedEntry();
    const localEntry = hydratedEntry({ timeout: { totalMs: 1_000 } });
    const provider = createNodeEvalHostReadiness({
      entry: localEntry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async () =>
        Response.json(manifest(deployedEntry, "production")),
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining("stale or unsupported"),
      remedy: expect.stringContaining("runtime generate"),
    });
  });
}
