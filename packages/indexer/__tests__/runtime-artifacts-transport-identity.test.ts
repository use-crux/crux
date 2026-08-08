/**
 * Runtime artifact identity findings for managed-transport bindings.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it } from "vitest";
import { generateRuntimeArtifacts } from "../src/indexer/runtime-artifacts";

const roots: string[] = [];
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(testWorkspaceRoot, ".tmp-runtime-artifacts-transport-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime artifact transport identity findings", () => {
  it("rejects duplicate managed-transport binding identities during program generation", async () => {
    const root = await fixtureRoot();
    const providerFile = join(root, "src/orders-provider.ts");
    const first = join(root, "src/orders-a.ts");
    const second = join(root, "src/orders-b.ts");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(providerFile, "export const ordersProvider = true\n");
    await writeFile(first, "export const firstBinding = true\n");
    await writeFile(second, "export const secondBinding = true\n");

    const definitions = [
      {
        id: "signal.provider:orders.webhook",
        kind: "signal.provider",
        name: "orders.webhook",
        fidelity: "resolved",
        fingerprint: "provider-orders-v1",
        source: { file: providerFile, line: 1 },
        metadata: {
          exportName: "ordersProvider",
          exported: true,
          facts: {
            kind: "signal.provider",
            providerId: "orders.webhook",
            transportKind: "webhook",
            identity: "static",
          },
        },
      },
      {
        id: "signal.transportBinding:binding.orders:a",
        kind: "signal.transportBinding",
        name: "binding.orders",
        fidelity: "resolved",
        fingerprint: "binding-orders-a",
        source: { file: first, line: 1 },
        metadata: {
          exportName: "firstBinding",
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
      {
        id: "signal.transportBinding:binding.orders:b",
        kind: "signal.transportBinding",
        name: "binding.orders",
        fidelity: "resolved",
        fingerprint: "binding-orders-b",
        source: { file: second, line: 1 },
        metadata: {
          exportName: "secondBinding",
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

    try {
      await generateRuntimeArtifacts({ root, host: "next", definitions });
      expect.unreachable("expected Runtime artifact generation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: "TARGET_DUPLICATE",
            featureKind: "transport",
            featureId: "binding.orders",
          }),
        ]),
      });
    }
  });

  it("rejects transport bindings whose provider identity is not exported", async () => {
    const root = await fixtureRoot();
    const sourceFile = join(root, "src/orphan-binding.ts");
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "export const orphanBinding = true\n");

    const definitions = [
      {
        id: "signal.transportBinding:binding.orphan",
        kind: "signal.transportBinding",
        name: "binding.orphan",
        fidelity: "resolved",
        fingerprint: "binding-orphan-v1",
        source: { file: sourceFile, line: 1 },
        metadata: {
          exportName: "orphanBinding",
          exported: true,
          facts: {
            kind: "signal.transportBinding",
            bindingId: "binding.orphan",
            providerId: "missing.provider",
            signalId: "order.submitted",
            identity: "static",
          },
        },
      },
    ] satisfies readonly ProjectDefinition[];

    try {
      await generateRuntimeArtifacts({ root, host: "next", definitions });
      expect.unreachable("expected Runtime artifact generation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: "CAPABILITY_MISSING",
            featureKind: "transport",
            featureId: "binding.orphan",
          }),
        ]),
      });
    }
  });
});
