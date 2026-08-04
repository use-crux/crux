import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import {
  IndexSignalProviderDetail,
  IndexSignalTransportBindingDetail,
} from "./signal-catalog";

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "signal:order.submitted",
      kind: "signal",
      name: "order.submitted",
      fidelity: "resolved",
      metadata: {
        facts: { kind: "signal", signalId: "order.submitted" },
      },
    },
    {
      id: "signal.provider:orders.webhook",
      kind: "signal.provider",
      name: "orders.webhook",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "signal.provider",
          providerId: "orders.webhook",
          identity: "static",
          transportKind: "webhook",
          signalIds: ["order.submitted"],
          hasOnEvent: true,
        },
      },
    },
    {
      id: "signal.transportBinding:binding.orders",
      kind: "signal.transportBinding",
      name: "binding.orders",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "signal.transportBinding",
          bindingId: "binding.orders",
          identity: "static",
          providerId: "orders.webhook",
          providerDefinitionId: "signal.provider:orders.webhook",
          configRef: {
            kind: "literal",
            id: "config.orders",
            revision: "rev.1",
          },
          signalId: "order.submitted",
          target: { kind: "signal", signalId: "order.submitted" },
        },
      },
    },
  ],
  relations: [
    {
      id: "rel-provider-signal",
      type: "signal.provider.publishes_signal",
      from: "signal.provider:orders.webhook",
      to: "signal:order.submitted",
      fidelity: "resolved",
    },
    {
      id: "rel-binding-provider",
      type: "signal.transportBinding.binds_provider",
      from: "signal.transportBinding:binding.orders",
      to: "signal.provider:orders.webhook",
      fidelity: "resolved",
    },
  ],
  sources: [],
  sourceGraph: [],
  diagnostics: [],
  lintFindings: [],
} as unknown as ProjectIndexData;

describe("signal catalog", () => {
  it("renders provider identity and Signal map lineage without callbacks", () => {
    const index = buildIndex(data);
    const definition = index.byId("signal.provider:orders.webhook")!;
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <IndexSignalProviderDetail def={definition} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );
    expect(html).toContain("orders.webhook");
    expect(html).toContain("webhook");
    expect(html).toContain("order.submitted");
    expect(html).toContain("present");
    expect(html).not.toMatch(/onEvent\(/i);
  });

  it("renders transport binding config-ref and Signal target lineage", () => {
    const index = buildIndex(data);
    const definition = index.byId("signal.transportBinding:binding.orders")!;
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <IndexSignalTransportBindingDetail def={definition} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );
    expect(html).toContain("binding.orders");
    expect(html).toContain("config.orders@rev.1");
    expect(html).toContain("order.submitted");
    expect(html).not.toMatch(/credential|Request|secret/i);
  });
});
