// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import {
  IndexSignalProviderDetail,
  IndexSignalTransportBindingDetail,
} from "./signal-catalog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

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
  afterEach(() => {
    document.body.replaceChildren();
  });

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

  it("renders managed SSE transport kind on provider catalog rows", () => {
    const sseData = {
      ...data,
      definitions: [
        ...data.definitions.filter(
          (definition) => definition.kind !== "signal.provider",
        ),
        {
          id: "signal.provider:orders.live",
          kind: "signal.provider",
          name: "orders.live",
          fidelity: "resolved",
          metadata: {
            facts: {
              kind: "signal.provider",
              providerId: "orders.live",
              identity: "static",
              transportKind: "sse",
              signalIds: ["order.submitted"],
              hasOnEvent: true,
            },
          },
        },
      ],
    } as unknown as ProjectIndexData;
    const index = buildIndex(sseData);
    const definition = index.byId("signal.provider:orders.live")!;
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <IndexSignalProviderDetail def={definition} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );
    // Identifiers omit "sse" so the transport value assertion is not a false positive.
    expect(html).toContain("orders.live");
    expect(html).toMatch(/transport<\/span><span[^>]*>sse<\/span>/);
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

  it("selects the canonical Signal definition from provider lineage", async () => {
    const index = buildIndex(data);
    const definition = index.byId("signal.provider:orders.webhook")!;
    const select = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <IndexIndexProvider index={index}>
          <IndexSelectProvider select={select}>
            <IndexSignalProviderDetail def={definition} />
          </IndexSelectProvider>
        </IndexIndexProvider>,
      );
    });
    const signalLink = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "order.submitted",
    );
    expect(signalLink).toBeDefined();

    await act(async () => signalLink?.click());

    expect(select).toHaveBeenCalledWith("signal:order.submitted");
    await act(async () => root.unmount());
  });

  it("keeps a visible keyboard focus indicator on selectable ids", () => {
    const index = buildIndex(data);
    const definition = index.byId("signal.provider:orders.webhook")!;
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <IndexSignalProviderDetail def={definition} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );

    expect(html).toContain("focus-visible:outline");
  });
});
