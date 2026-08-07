import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  jsonStable,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("signal transport native static projection", () => {
  itWithRustOxc(
    "projects signal, webhook, provider, and managed binding with lineage",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: [
          "signal",
          "webhook",
          "signalProvider",
          "managedTransportBinding",
        ],
        callInterests: [
          {
            name: "signal",
            importFrom: ["@use-crux/core", "@use-crux/core/signal"],
          },
          {
            name: "webhook",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/transport"],
          },
          {
            name: "signalProvider",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/provider"],
          },
          {
            name: "managedTransportBinding",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/provider"],
          },
        ],
        source: [
          `import { signal } from '@use-crux/core/signal'`,
          `import { webhook } from '@use-crux/core/signal/transport'`,
          `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
          `import { z } from 'zod'`,
          `export const orderSubmitted = signal({`,
          `  id: 'order.submitted',`,
          `  schema: z.object({ orderId: z.string() }),`,
          `})`,
          `const ingress = webhook({ async handle() { throw new Error('PRIVATE_SIGNAL_HANDLE') } })`,
          `export const ordersProvider = signalProvider({`,
          `  id: 'orders.webhook',`,
          `  transport: ingress,`,
          `  signals: { orderSubmitted },`,
          `  async onEvent() { throw new Error('PRIVATE_SIGNAL_EVENT') },`,
          `})`,
          `export const ordersBinding = managedTransportBinding(ordersProvider, {`,
          `  id: 'binding.orders',`,
          `  configRef: { id: 'config.orders', revision: 'rev.1' },`,
          `  signalId: 'order.submitted',`,
          `})`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "signal")).toBe(1);
      expect(nativeFactCount(result.record, "signal.transport")).toBe(1);
      expect(nativeFactCount(result.record, "signal.provider")).toBe(1);
      expect(nativeFactCount(result.record, "signal.transportBinding")).toBe(1);

      const provider = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.provider",
      );
      expect(provider).toMatchObject({
        kind: "signal.provider",
        name: "orders.webhook",
        metadata: {
          exportName: "ordersProvider",
          exported: true,
          facts: {
            kind: "signal.provider",
            providerId: "orders.webhook",
            identity: "static",
            transportKind: "webhook",
            hasOnEvent: true,
          },
        },
      });

      const binding = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.transportBinding",
      );
      expect(binding).toMatchObject({
        kind: "signal.transportBinding",
        name: "binding.orders",
        metadata: {
          exportName: "ordersBinding",
          exported: true,
          facts: {
            kind: "signal.transportBinding",
            bindingId: "binding.orders",
            identity: "static",
            providerId: "orders.webhook",
            signalId: "order.submitted",
            configRef: {
              kind: "literal",
              id: "config.orders",
              revision: "rev.1",
            },
          },
        },
      });

      expect(
        result.nativeOut.relations.map((relation) => relation.type).sort(),
      ).toEqual([
        "signal.provider.publishes_signal",
        "signal.provider.uses_transport",
        "signal.transportBinding.binds_provider",
        "signal.transportBinding.targets_signal",
      ]);

      // Structured facts must not retain live credentials or handler bodies.
      // Call sourceSnippet text may still quote the authored call span.
      expect(
        JSON.stringify(
          result.nativeOut.definitions.map(
            (definition) => definition.metadata?.facts,
          ),
        ),
      ).not.toMatch(/credential|password|apiKey|secret|token/);
      expect(
        JSON.stringify(
          result.nativeOut.definitions.map(
            (definition) => definition.metadata?.facts,
          ),
        ),
      ).not.toContain("PRIVATE_SIGNAL");
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
  );

  itWithRustOxc(
    "flags live binding fields and unstable provider identity",
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
          {
            name: "webhook",
            importFrom: ["@use-crux/core/signal/transport"],
          },
        ],
        source: [
          `import { managedTransportBinding, signalProvider } from '@use-crux/core/signal/provider'`,
          `import { webhook } from '@use-crux/core/signal/transport'`,
          `declare const dynamicId: string`,
          `const provider = signalProvider({`,
          `  id: dynamicId,`,
          `  transport: webhook({ async handle() { throw new Error('unused') } }),`,
          `  signals: {},`,
          `  async onEvent() {},`,
          `})`,
          `export const badBinding = managedTransportBinding(provider, {`,
          `  id: 'binding.live',`,
          `  configRef: { id: 'config.live', revision: 'rev.1' },`,
          `  signalId: 'order.submitted',`,
          `  request: new Request('https://example.test'),`,
          `  client: {},`,
          `})`,
        ].join("\n"),
      });

      const provider = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.provider",
      );
      expect(provider?.metadata?.facts).toMatchObject({
        kind: "signal.provider",
        identity: "partial",
      });

      const binding = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.transportBinding",
      );
      expect(binding?.metadata?.facts).toMatchObject({
        kind: "signal.transportBinding",
        identity: "partial",
        liveFields: ["client", "request"],
      });
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
  );

  itWithRustOxc(
    "projects polling transport with hasPoll and provider transportKind",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["signal", "polling", "signalProvider"],
        callInterests: [
          {
            name: "signal",
            importFrom: ["@use-crux/core", "@use-crux/core/signal"],
          },
          {
            name: "polling",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/transport"],
          },
          {
            name: "signalProvider",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/provider"],
          },
        ],
        source: [
          `import { signal } from '@use-crux/core/signal'`,
          `import { polling } from '@use-crux/core/signal/transport'`,
          `import { signalProvider } from '@use-crux/core/signal/provider'`,
          `import { z } from 'zod'`,
          `export const orderSubmitted = signal({`,
          `  id: 'order.submitted',`,
          `  schema: z.object({ orderId: z.string() }),`,
          `})`,
          `const ingress = polling({`,
          `  intervalMs: 5_000,`,
          `  async poll() { throw new Error('PRIVATE_POLL') },`,
          `})`,
          `export const ordersPoll = signalProvider({`,
          `  id: 'orders.poll',`,
          `  transport: ingress,`,
          `  signals: { orderSubmitted },`,
          `  async onEvent() { throw new Error('PRIVATE_SIGNAL_EVENT') },`,
          `})`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "signal.transport.polling")).toBe(
        1,
      );
      const transport = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.transport",
      );
      expect(transport).toMatchObject({
        kind: "signal.transport",
        name: "ingress",
        metadata: {
          facts: {
            kind: "signal.transport",
            transportKind: "polling",
            hasPoll: true,
          },
        },
      });
      const provider = result.nativeOut.definitions.find(
        (definition) => definition.kind === "signal.provider",
      );
      expect(provider?.metadata?.facts).toMatchObject({
        kind: "signal.provider",
        providerId: "orders.poll",
        transportKind: "polling",
      });
      expect(
        JSON.stringify(
          result.nativeOut.definitions.map(
            (definition) => definition.metadata?.facts,
          ),
        ),
      ).not.toContain("PRIVATE_POLL");
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
  );

  itWithRustOxc(
    "ignores lookalike signal transport helpers",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: [
          "signal",
          "webhook",
          "signalProvider",
          "managedTransportBinding",
        ],
        callInterests: [
          {
            name: "signal",
            importFrom: ["@use-crux/core", "@use-crux/core/signal"],
          },
          {
            name: "webhook",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/transport"],
          },
          {
            name: "signalProvider",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/provider"],
          },
          {
            name: "managedTransportBinding",
            importFrom: ["@use-crux/core", "@use-crux/core/signal/provider"],
          },
        ],
        source: [
          `const signal = (input: unknown) => input`,
          `const webhook = (input: unknown) => input`,
          `const signalProvider = (input: unknown) => input`,
          `const managedTransportBinding = (a: unknown, b: unknown) => b`,
          `export const local = signal({ id: 'local' })`,
          `export const localWebhook = webhook({ handle() {} })`,
          `export const localProvider = signalProvider({ id: 'x' })`,
          `export const localBinding = managedTransportBinding(localProvider, { id: 'y' })`,
        ].join("\n"),
      });

      expect(
        result.nativeOut.definitions.filter((definition) =>
          definition.kind.startsWith("signal"),
        ),
      ).toEqual([]);
      expect(jsonStable(result.nativeOut)).toEqual(
        jsonStable(result.typescriptOut),
      );
    },
  );
});
