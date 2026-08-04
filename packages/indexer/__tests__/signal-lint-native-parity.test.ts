import { describe, expect } from "vitest";
import { canonicalIndexPatchFactsJson } from "../src/contracts/parity";
import { finalizeStaticIndexFactsWithWorker } from "../src/testing/static-index-worker";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

const signalRuleIds = [
  "signal.provider.unstable_identity",
  "signal.transportBinding.live_value",
  "signal.transportBinding.unstable_identity",
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

      const invalidNative = await signalFindings(invalid.nativeOut);
      const invalidTypescript = await signalFindings(invalid.typescriptOut);
      expect(canonicalFindings(invalidNative)).toBe(
        canonicalFindings(invalidTypescript),
      );
      expect(findingEvidence(invalidTypescript)).toEqual([
        {
          ruleId: "signal.provider.unstable_identity",
          primaryDefinitionId: "signal.provider:src-fixture.ts:4:18",
          evidence: [
            {
              kind: "definition",
              label: "Authored Signal provider declaration",
              definitionId: "signal.provider:src-fixture.ts:4:18",
              data: {
                fidelity: "resolved",
                kind: "signal.provider",
                name: "provider",
              },
            },
          ],
        },
        {
          ruleId: "signal.transportBinding.live_value",
          primaryDefinitionId:
            "signal.transportBinding:src-fixture.ts:10:24",
          evidence: [
            {
              kind: "definition",
              label: "Authored managed transport binding declaration",
              definitionId: "signal.transportBinding:src-fixture.ts:10:24",
              data: {
                fidelity: "resolved",
                kind: "signal.transportBinding",
                name: "binding.orders",
              },
            },
          ],
        },
        {
          ruleId: "signal.transportBinding.unstable_identity",
          primaryDefinitionId:
            "signal.transportBinding:src-fixture.ts:10:24",
          evidence: [
            {
              kind: "definition",
              label: "Authored managed transport binding declaration",
              definitionId: "signal.transportBinding:src-fixture.ts:10:24",
              data: {
                fidelity: "resolved",
                kind: "signal.transportBinding",
                name: "binding.orders",
              },
            },
          ],
        },
      ]);

      const validNative = await signalFindings(valid.nativeOut);
      const validTypescript = await signalFindings(valid.typescriptOut);
      expect(validNative).toEqual([]);
      expect(validTypescript).toEqual([]);
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

async function signalFindings(
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

function canonicalFindings(findings: Awaited<ReturnType<typeof signalFindings>>) {
  return canonicalIndexPatchFactsJson({ lintFindings: findings });
}

function findingEvidence(
  findings: Awaited<ReturnType<typeof signalFindings>>,
) {
  return [...findings]
    .sort((left, right) => compareCodepoint(left.ruleId, right.ruleId))
    .map((finding) => ({
      ruleId: finding.ruleId,
      primaryDefinitionId: finding.primaryDefinitionId,
      evidence: finding.evidence.map(
        ({ kind, label, definitionId, data }) => ({
          kind,
          label,
          definitionId,
          data,
        }),
      ),
    }));
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
