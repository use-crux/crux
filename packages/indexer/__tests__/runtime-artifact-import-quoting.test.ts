import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import { generateRuntimeArtifacts } from "../src/indexer/runtime-artifacts";

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

describe("runtime artifact import quoting", () => {
  it("quotes generated target, provider, and transport module specifiers", async () => {
    const root = await fixtureRoot();
    const sourceFile = join(root, "src/o'reilly/orders.ts");
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(
      sourceFile,
      "export const reviewFlow = {}, ordersProvider = {}, ordersBinding = {}\n",
    );
    const definitions = [
      {
        id: "flow:review",
        kind: "flow",
        name: "review",
        fidelity: "resolved",
        fingerprint: "flow-v1",
        source: { file: sourceFile, line: 1 },
        metadata: { exportName: "reviewFlow" },
      },
      {
        id: "signal.provider:orders.webhook",
        kind: "signal.provider",
        name: "orders.webhook",
        fidelity: "resolved",
        fingerprint: "provider-v1",
        source: { file: sourceFile, line: 1 },
        metadata: {
          exportName: "ordersProvider",
          exported: true,
          facts: {
            kind: "signal.provider",
            providerId: "orders.webhook",
            identity: "static",
          },
        },
      },
      {
        id: "signal.transportBinding:binding.orders",
        kind: "signal.transportBinding",
        name: "binding.orders",
        fidelity: "resolved",
        fingerprint: "binding-v1",
        source: { file: sourceFile, line: 1 },
        metadata: {
          exportName: "ordersBinding",
          exported: true,
          facts: {
            kind: "signal.transportBinding",
            bindingId: "binding.orders",
            providerId: "orders.webhook",
            signalId: "order.submitted",
            identity: "static",
          },
        },
      },
    ] satisfies readonly ProjectDefinition[];

    const result = await generateRuntimeArtifacts({
      root,
      host: "next",
      definitions,
    });
    const program = await readFile(
      join(root, ".crux/generated/runtime/program.ts"),
      "utf8",
    );

    expect(program).toContain(
      `from ${JSON.stringify("../../../src/o'reilly/orders")}`,
    );
    expect(program).not.toContain("from '../../../src/o'reilly/orders'");
    expect(result.manifest.targets).toHaveLength(1);
    expect(result.manifest.providers).toHaveLength(1);
    expect(result.manifest.transports).toHaveLength(1);
  });
});
