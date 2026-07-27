import { expect, it } from "vitest";

import { createNodeEvalHostReadiness } from "../../../src/eval/node/host/readiness";
import { connectionEnvironment, hydratedEntry, manifest } from "./fixture";

/** Register V2 protocol and structured-timeout readiness behavior. */
export function defineProtocolV2ReadinessBehavior(): void {
  it("requires the V2 structured-timeout capability for new remote work", async () => {
    const entry = hydratedEntry();
    const deployed = manifest(entry, "production");
    const legacy = {
      ...deployed,
      protocol: "crux.eval-host.v1",
      capabilities: deployed.capabilities.filter(
        (capability) => capability !== "structured-timeout",
      ),
    };
    const current = {
      ...deployed,
      protocol: "crux.eval-host.v2",
    };

    await expect(readiness(entry, legacy)).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining("protocol"),
    });
    await expect(readiness(entry, current)).resolves.toMatchObject({
      status: "verified",
      deploymentId: "production",
    });
    await expect(
      readiness(entry, {
        ...current,
        capabilities: current.capabilities.filter(
          (capability) => capability !== "structured-timeout",
        ),
      }),
    ).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining("structured timeout"),
    });
  });
}

async function readiness(
  entry: ReturnType<typeof hydratedEntry>,
  deployed: ReturnType<typeof manifest> & {
    readonly protocol: string;
    readonly capabilities: readonly string[];
  },
) {
  const provider = createNodeEvalHostReadiness({
    entry,
    projectRoot: "/does-not-read-files",
    processEnvironment: connectionEnvironment(),
    transport: async () => Response.json(deployed),
  });
  return await provider.resolve([]);
}
