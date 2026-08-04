import { describe, expect } from "vitest";
import { signalProviderFindings } from "../src/indexer/signal/findings";
import { finalizeStaticIndexFactsWithWorker } from "../src/testing/static-index-worker";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

const signalRuleIds = [
  "signal.provider.unstable_identity",
  "signal.transportBinding.unstable_identity",
  "signal.transportBinding.live_value",
] as const;

describe("Signal lint native parity", () => {
  itWithRustOxc(
    "proves positive and negative evidence for every Signal rule",
    async () => {
      const invalid = await extractSignalFixture([
        `declare const dynamicId: string`,
        `const provider = signalProvider({`,
        `  id: dynamicId,`,
        `  transport: webhook({ handle() {} }),`,
        `  signals: {},`,
        `  onEvent() {},`,
        `})`,
        `export const binding = managedTransportBinding(provider, {`,
        `  id: 'binding.orders',`,
        `  configRef: { id: 'config.orders', revision: 'rev.1' },`,
        `  signalId: dynamicId,`,
        `  request: new Request('https://example.test'),`,
        `})`,
      ]);
      const valid = await extractSignalFixture([
        `const provider = signalProvider({`,
        `  id: 'orders.webhook',`,
        `  transport: webhook({ handle() {} }),`,
        `  signals: {},`,
        `  onEvent() {},`,
        `})`,
        `export const binding = managedTransportBinding(provider, {`,
        `  id: 'binding.orders',`,
        `  configRef: { id: 'config.orders', revision: 'rev.1' },`,
        `  signalId: 'order.submitted',`,
        `})`,
      ]);

      const invalidNative = await nativeFindings(invalid.nativeOut);
      const invalidTypescript = invalid.typescriptOut.definitions.flatMap(
        signalProviderFindings,
      );
      expect(ruleIds(invalidNative)).toEqual(signalRuleIds);
      expect(ruleIds(invalidTypescript)).toEqual(signalRuleIds);
      expect(
        Object.fromEntries(
          invalidTypescript.map((finding) => [
            finding.ruleId,
            finding.evidence[0]?.label,
          ]),
        ),
      ).toEqual({
        "signal.provider.unstable_identity":
          "Authored Signal provider declaration",
        "signal.transportBinding.unstable_identity":
          "Authored managed transport binding declaration",
        "signal.transportBinding.live_value":
          "Authored managed transport binding declaration",
      });

      const validNative = await nativeFindings(valid.nativeOut);
      const validTypescript = valid.typescriptOut.definitions.flatMap(
        signalProviderFindings,
      );
      expect(ruleIds(validNative)).toEqual([]);
      expect(ruleIds(validTypescript)).toEqual([]);
    },
    120_000,
  );
});

async function extractSignalFixture(lines: readonly string[]) {
  return extractNativeAndFallback({
    callNames: ["signalProvider", "managedTransportBinding", "webhook"],
    callInterests: [
      {
        name: "signalProvider",
        importFrom: ["@use-crux/core/signal/provider"],
      },
      {
        name: "managedTransportBinding",
        importFrom: ["@use-crux/core/signal/provider"],
      },
      {
        name: "webhook",
        importFrom: ["@use-crux/core/signal/transport"],
      },
    ],
    source: [
      `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
      `import { webhook } from '@use-crux/core/signal/transport'`,
      ...lines,
    ].join("\n"),
  });
}

async function nativeFindings(
  output: Awaited<ReturnType<typeof extractSignalFixture>>["nativeOut"],
) {
  const facts = await finalizeStaticIndexFactsWithWorker({
    root: "/workspace/acme",
    nativeFacts: [
      { definitions: output.definitions, relations: output.relations },
    ],
  });
  return (facts.lintFindings ?? []).filter((finding) =>
    signalRuleIds.some((ruleId) => ruleId === finding.ruleId),
  );
}

function ruleIds(
  findings: readonly { readonly ruleId: string }[],
): readonly string[] {
  return signalRuleIds.filter((ruleId) =>
    findings.some((finding) => finding.ruleId === ruleId),
  );
}
