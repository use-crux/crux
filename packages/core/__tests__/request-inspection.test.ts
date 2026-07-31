import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapter,
  context,
  inspectRequest,
  prefer,
  prompt,
  RequestInspectionUnavailableError,
  type AdapterSpec,
} from "../src";
import { historyResponse as response } from "./request-history-harness";
import {
  acceptedDeliveryReceipt,
  createHttpObservabilityTransport,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../src/observability";

afterEach(() => {
  vi.useRealTimers();
  resetObservabilityRuntime();
});

describe("request inspection", () => {
  it("retains full redacted candidate evidence across receipt serialization", async () => {
    const secret = "private-source-material ".repeat(200);
    const detailed = context({
      id: "inspection-source",
      system: secret,
    });
    const compact = context({
      id: "inspection-compact",
      system: "Compact source.",
    });
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "inspection-test",
      capacity: () => ({
        contextWindow: 4_096,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call() {
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };
    const result = await adapter(spec)({}).generate(
      prompt({
        id: "request-inspection",
        use: [prefer(detailed, compact)],
        prompt: "Answer.",
      }),
      {
        model: "inspection-model",
        inputBudget: { max: 80 },
      },
    );
    const receipt = result.steps[0]!.request!;
    const serialized = JSON.parse(JSON.stringify(receipt)) as {
      readonly id: string;
    };
    const direct = await receipt.inspect();
    const retained = await inspectRequest(serialized);

    expect(retained).toEqual(direct);
    expect(retained).toMatchObject({
      id: receipt.id,
      contributions: [
        expect.objectContaining({
          id: "inspection-source",
          sources: ["context:inspection-source"],
        }),
      ],
      candidates: expect.arrayContaining([
        expect.objectContaining({
          contributor: "inspection-source",
          representation: "full",
          selected: false,
          rejectionReason: "over-limit",
        }),
        expect.objectContaining({
          contributor: "inspection-source",
          representation: "authored",
          selected: true,
        }),
      ]),
      counting: {
        measurement: "estimated",
        attribution: "estimated",
      },
      linkedRequestIds: [],
    });
    expect(JSON.stringify(retained)).not.toContain(secret);
    expect(Object.keys(receipt)).not.toContain("inspect");
  });

  it("fails standalone lookup cleanly after retention expires while a live receipt remains inspectable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00Z"));
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "inspection-expiry-test",
      async call() {
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };
    const result = await adapter(spec)({}).generate(
      prompt({ id: "inspection-expiry", prompt: "Hello." }),
      { model: "expiry-model" },
    );
    const receipt = result.steps[0]!.request!;
    const serialized = JSON.parse(JSON.stringify(receipt)) as {
      readonly id: string;
    };

    vi.advanceTimersByTime(5 * 60_000 + 1);

    await expect(inspectRequest(serialized)).rejects.toBeInstanceOf(
      RequestInspectionUnavailableError,
    );
    await expect(receipt.inspect()).resolves.toMatchObject({ id: receipt.id });
  });

  it("loads retained inspection through the configured observability destination", async () => {
    const retained = {
      id: "request_remote_retained",
      contributions: [{
        id: "prompt",
        sources: ["prompt"],
        priority: 0,
        boundary: "required" as const,
        representations: ["full"],
      }],
      candidates: [],
      breakdown: {
        total: 4,
        attribution: "estimated" as const,
        contributions: [
          { contributor: "messages", tokens: 4 },
        ],
      },
      measurement: "estimated" as const,
      counting: {
        measurement: "estimated" as const,
        attribution: "estimated" as const,
        safetyMarginTokens: 1,
        providerOverheadTokens: 1,
      },
      retryCount: 0,
      artifacts: [],
      supportTools: [],
      supportRequests: [],
      linkedRequestIds: [],
      preparation: {
        operation: "language" as const,
        stepIndex: 0,
        reason: "initial" as const,
        amendment: {
          addedContributors: 0,
          removedContributors: 0,
          contributedTools: 0,
          activeTools: undefined,
          modelChanged: false,
          inputBudgetChanged: false,
        },
        resources: [{
          identity: "working-state:control",
          revision: "revision-1",
          valueHash: "hash-1",
        }],
        sealedRequestId: "request_remote_retained",
      },
      retention: "requires observability retention" as const,
    };
    const privateContent = "PRIVATE_DESTINATION_CONTENT";
    const inspectRetained = vi.fn(async () => ({
      ...retained,
      privateContent,
      contributions: retained.contributions.map((contribution) => ({
        ...contribution,
        privateContent,
      })),
      preparation: {
        ...retained.preparation,
        privateContent,
        resources: retained.preparation.resources.map((resource) => ({
          ...resource,
          privateContent,
        })),
      },
    }));
    setObservabilityTransport({
      send: (records) => acceptedDeliveryReceipt(records),
      requestInspection: { inspectRequest: inspectRetained },
    });

    await expect(inspectRequest(retained.id)).resolves.toEqual(retained);
    expect(inspectRetained).toHaveBeenCalledWith(retained.id);
    expect(JSON.stringify(await inspectRequest(retained.id))).not.toContain(
      privateContent,
    );
  });

  it("uses the Local request-inspection endpoint for serialized receipts", async () => {
    const retained = {
      id: "request_http_retained",
      contributions: [],
      candidates: [],
      breakdown: {
        total: 4,
        attribution: "estimated" as const,
        contributions: [{ contributor: "messages", tokens: 4 }],
      },
      measurement: "estimated" as const,
      counting: {
        measurement: "estimated" as const,
        attribution: "estimated" as const,
        safetyMarginTokens: 1,
        providerOverheadTokens: 1,
      },
      retryCount: 0,
      artifacts: [],
      supportTools: [],
      supportRequests: [],
      linkedRequestIds: [],
      retention: "requires observability retention" as const,
    };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://127.0.0.1:4400/api/observability/requests/inspect",
      );
      expect(JSON.parse(String(init?.body))).toEqual({ id: retained.id });
      return new Response(JSON.stringify(retained), { status: 200 });
    });
    setObservabilityTransport(
      createHttpObservabilityTransport({
        serverUrl: "http://127.0.0.1:4400",
        fetch,
      }),
    );

    await expect(inspectRequest(retained.id)).resolves.toEqual(retained);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
