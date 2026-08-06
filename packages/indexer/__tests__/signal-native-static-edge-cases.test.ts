import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  jsonStable,
} from "./native-first-party-fixture-helpers";

describe("Signal native static projection edge cases", () => {
  itWithRustOxc(
    "normalizes provider relation ids with hostile authored identities",
    async () => {
      const result = await extractNativeAndFallback({
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
          { name: "webhook", importFrom: ["@use-crux/core/signal/transport"] },
        ],
        source: [
          `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
          `import { webhook } from '@use-crux/core/signal/transport'`,
          `const provider = signalProvider({ id: 'orders / webhook', transport: webhook({ handle() {} }), signals: {}, onEvent() {} })`,
          `export const binding = managedTransportBinding(provider, { id: 'binding.orders', configRef: { id: 'config.orders', revision: 'rev.1' }, signalId: 'order.submitted' })`,
        ].join("\n"),
      });

      expect(result.nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "signal.transportBinding.binds_provider",
            to: "signal.provider:orders-webhook",
          }),
        ]),
      );
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
    120_000,
  );

  itWithRustOxc(
    "resolves hoisted provider ids for managed binding lineage",
    async () => {
      const result = await extractNativeAndFallback({
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
          { name: "webhook", importFrom: ["@use-crux/core/signal/transport"] },
        ],
        source: [
          `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
          `import { webhook } from '@use-crux/core/signal/transport'`,
          `const providerId = 'orders.webhook'`,
          `const provider = signalProvider({ id: providerId, transport: webhook({ handle() {} }), signals: {}, onEvent() {} })`,
          `export const binding = managedTransportBinding(provider, { id: 'binding.orders', configRef: { id: 'config.orders', revision: 'rev.1' }, signalId: 'order.submitted' })`,
        ].join("\n"),
      });

      const binding = result.typescriptOut.definitions.find(
        (definition) => definition.kind === "signal.transportBinding",
      );
      expect(binding?.metadata?.facts).toMatchObject({
        identity: "static",
        providerDefinitionId: "signal.provider:orders.webhook",
        providerId: "orders.webhook",
      });
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
    120_000,
  );

  itWithRustOxc(
    "rejects nested local lookalikes without import evidence",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["signalProvider", "managedTransportBinding"],
        callInterests: [
          {
            name: "signalProvider",
            importFrom: ["@use-crux/core/signal/provider"],
          },
          {
            name: "managedTransportBinding",
            importFrom: ["@use-crux/core/signal/provider"],
          },
        ],
        source: [
          `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
          `const webhook = (input: unknown) => input`,
          `const signal = (input: unknown) => input`,
          `const localProvider = (input: unknown) => input`,
          `const localSignal = signal({ id: 'local.signal' })`,
          `export const provider = signalProvider({ id: 'orders.webhook', transport: webhook({ handle() {} }), signals: { localSignal }, onEvent() {} })`,
          `const lookalike = localProvider({ id: 'local.provider' })`,
          `export const binding = managedTransportBinding(lookalike, { id: 'binding.orders', configRef: { id: 'config.orders', revision: 'rev.1' }, signalId: 'local.signal' })`,
        ].join("\n"),
      });

      const provider = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.provider",
      );
      expect(provider?.metadata?.facts).not.toHaveProperty("transportKind");
      expect(provider?.metadata?.facts).not.toHaveProperty("signalIds");
      const binding = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.transportBinding",
      );
      expect(binding?.metadata?.facts).toMatchObject({ identity: "partial" });
      expect(binding?.metadata?.facts).not.toHaveProperty("providerId");
      expect(binding?.metadata?.facts).not.toHaveProperty(
        "providerDefinitionId",
      );
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
    120_000,
  );

  itWithRustOxc(
    "emits partial Signal definitions when static ids are unavailable",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["signal"],
        callInterests: [
          { name: "signal", importFrom: ["@use-crux/core/signal"] },
        ],
        source: [
          `import { signal } from '@use-crux/core/signal'`,
          `import { z } from 'zod'`,
          `declare const dynamicId: string`,
          `export const dynamicSignal = signal({ id: dynamicId, schema: z.string() })`,
          `export const missingSignal = signal({ schema: z.string() })`,
        ].join("\n"),
      });

      const signals = result.nativeOut.definitions.filter(
        (definition) => definition.kind === "signal",
      );
      expect(signals).toHaveLength(2);
      expect(signals.map((definition) => definition.metadata?.facts)).toEqual([
        { kind: "signal", identity: "partial" },
        { kind: "signal", identity: "partial" },
      ]);
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
    120_000,
  );

  itWithRustOxc(
    "links inline webhook providers to the canonical transport definition",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["signalProvider", "webhook"],
        callInterests: [
          {
            name: "signalProvider",
            importFrom: ["@use-crux/core/signal/provider"],
          },
          { name: "webhook", importFrom: ["@use-crux/core/signal/transport"] },
        ],
        source: [
          `import { signalProvider } from '@use-crux/core/signal/provider'`,
          `import { webhook } from '@use-crux/core/signal/transport'`,
          `export const provider = signalProvider({ id: 'orders.webhook', transport: webhook({ handle() {} }), signals: {}, onEvent() {} })`,
        ].join("\n"),
      });

      const provider = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.provider",
      );
      const transport = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.transport",
      );
      expect(result.nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "signal.provider.uses_transport",
            from: provider?.id,
            to: transport?.id,
          }),
        ]),
      );
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
    120_000,
  );
});
