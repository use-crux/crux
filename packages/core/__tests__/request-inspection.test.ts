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

afterEach(() => {
  vi.useRealTimers();
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
});
