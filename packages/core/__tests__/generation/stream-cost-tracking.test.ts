import {
  applyPlugins,
  getHooks,
  resetHooks,
  resetObservabilityRuntime,
  setHooks,
} from "@use-crux/core";
import { withCostTracking } from "@use-crux/core/cost";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeAdapter,
  textPrompt,
} from "./stream-result-correlation.fixtures";

describe("core-step stream cost tracking", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("does not request provider completion before stream consumption", async () => {
    const tracker = withCostTracking();
    setHooks(applyPlugins([tracker.asPlugin()], getHooks()).hooks);
    let completionCalls = 0;
    const result = await createFakeAdapter({
      onCompletion: () => completionCalls++,
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });

    await Promise.resolve();
    expect(completionCalls).toBe(0);

    for await (const _chunk of result.textStream) {
      // Public stream completion becomes available only after terminal drain.
    }
    await result.completion;
    expect(completionCalls).toBe(1);
  });
});
