import { describe, expect, it, vi } from "vitest";
import {
  adapter,
  CONSERVATIVE_MODEL_CAPACITY,
  type AdapterSpec,
  type ModelCapacityProfile,
} from "../src/adapter";

type TestSpec = AdapterSpec<object>;

const knownProfile: ModelCapacityProfile = {
  contextWindow: 128_000,
  defaultOutputReserve: 16_384,
  countingConfidence: "estimated",
};

function testSpec(overrides: Partial<TestSpec> = {}): TestSpec {
  return {
    providerId: "test",
    call: vi.fn(),
    stream: vi.fn(),
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
    ...overrides,
  };
}

describe("model capacity profiles", () => {
  it("reports a conservative profile when an adapter has no capacity hook", () => {
    const runtime = adapter(testSpec())({});

    expect(runtime.capacity("unknown-model")).toEqual(
      CONSERVATIVE_MODEL_CAPACITY,
    );
    expect(runtime.capacity("unknown-model")).toBe(
      CONSERVATIVE_MODEL_CAPACITY,
    );
  });

  it("reports known profiles and resolves unknown models through the adapter fallback", () => {
    const adapterFallback: ModelCapacityProfile = {
      contextWindow: 16_384,
      defaultOutputReserve: 4_096,
      countingConfidence: "conservative",
    };
    const runtime = adapter(
      testSpec({
        capacity: (model) =>
          model === "known-model" ? knownProfile : adapterFallback,
      }),
    )({});

    expect(runtime.capacity("known-model")).toEqual(knownProfile);
    expect(runtime.capacity("future-model")).toEqual(adapterFallback);
  });
});
