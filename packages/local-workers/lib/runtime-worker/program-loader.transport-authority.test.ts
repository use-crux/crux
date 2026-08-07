import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./program-loader.test-fixtures";
import { loadGeneratedRuntimeProgram } from "./program-loader";

const manifest = `${JSON.stringify({
  version: 3,
  evalPrivacyFingerprint: "safe",
  targets: [],
  effectTargets: [],
  providers: [
    {
      id: "orders.webhook",
      module: "./providers.ts",
      export: "orders",
      definitionId: "signal.provider:orders.webhook",
      fingerprint: "provider-v1",
    },
  ],
  transports: [
    {
      id: "binding.orders",
      module: "./providers.ts",
      export: "ordersBinding",
      definitionId: "signal.transportBinding:binding.orders",
      fingerprint: "binding-v1",
      providerId: "orders.webhook",
      signalId: "order.submitted",
    },
  ],
  evals: [],
})}\n`;
const hash = createHash("sha256").update(manifest).digest("hex");

function program(providers: string, transports: string): string {
  return [
    `export const runtimeArtifactManifestHash = '${hash}'`,
    "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
    `export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [], providers: ${providers}, transports: ${transports} }`,
  ].join("\n");
}

async function expectStale(
  providers: string,
  transports: string,
): Promise<void> {
  const root = await fixture({
    ".crux/generated/runtime/manifest.json": manifest,
    ".crux/generated/runtime/program.ts": program(providers, transports),
  });
  await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
    code: "ARTIFACTS_STALE",
    whatFailed: expect.stringContaining("providers or transports"),
  });
}

describe("generated runtime program transport authority", () => {
  it("rejects non-empty transports without generated provider authority", async () => {
    await expectStale("[]", "[{ id: 'binding.orders' }]");
  });

  it("rejects provider mismatches and malformed transport tuples", async () => {
    await expectStale(
      "[{ id: 'other.provider' }]",
      "[{ id: 'binding.orders' }]",
    );
    await expectStale(
      "[{ id: 'orders.webhook' }]",
      "[{ id: 'binding.orders' }]",
    );
  });

  it("uses adapter.provider rather than its local adapter id", async () => {
    await expectStale(
      "[{ id: 'orders.webhook' }]",
      "[{ id: 'binding.orders', adapter: { id: 'adapter.alias', provider: 'other.provider' }, target: { signalId: 'order.submitted' } }]",
    );
  });

  it("rejects signal drift when the binding id is unchanged", async () => {
    await expectStale(
      "[{ id: 'orders.webhook' }]",
      "[{ id: 'binding.orders', adapter: { id: 'adapter.alias', provider: 'orders.webhook' }, target: { signalId: 'order.cancelled' } }]",
    );
  });

  it("rejects transport-only drift when provider authority is aligned", async () => {
    const transportOnlyManifest = manifest.replace(
      '"transports":[{"id":"binding.orders","module":"./providers.ts","export":"ordersBinding","definitionId":"signal.transportBinding:binding.orders","fingerprint":"binding-v1","providerId":"orders.webhook","signalId":"order.submitted"}]',
      '"transports":[]',
    );
    const transportOnlyHash = createHash("sha256")
      .update(transportOnlyManifest)
      .digest("hex");
    const root = await fixture({
      ".crux/generated/runtime/manifest.json": transportOnlyManifest,
      ".crux/generated/runtime/program.ts": [
        `export const runtimeArtifactManifestHash = '${transportOnlyHash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [], providers: [{ id: 'orders.webhook' }], transports: [{ id: 'binding.orders', adapter: { id: 'adapter.alias', provider: 'orders.webhook' }, target: { signalId: 'order.submitted' } }] }",
      ].join("\n"),
    });

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: "ARTIFACTS_STALE",
      whatFailed: expect.stringContaining("providers or transports"),
    });
  });
});
