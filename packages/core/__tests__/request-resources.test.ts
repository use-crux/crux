import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  context,
  inMemoryStorage,
  memory,
  prompt,
  ResourceReadError,
  workingState,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";
import { blackboard } from "../src/agent";

function response(): AdapterResponse {
  return {
    text: "done",
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: "response-1",
    actualModelId: "model-1",
  };
}

function createRuntime() {
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-resources",
    async call(_client, args) {
      provider(args);
      return { raw: {}, extracted: response() };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return { provider, runtime: adapter(spec)({}) };
}

describe("prepareStep resources", () => {
  it("reads a Blackboard from the declared graph and pins one boundary value", async () => {
    const board = blackboard({
      id: "control-board",
      schema: z.object({ phase: z.string() }),
    });
    await board.patch({ phase: "draft" });
    const hidden = context({
      id: "hidden-control",
      use: [board],
      when: () => false,
      system: "",
    });
    const undeclared = blackboard({
      id: "other-board",
      schema: z.object({ phase: z.string() }),
    });
    const target = createRuntime();
    const values: unknown[] = [];

    const result = await target.runtime.generate(
      prompt({ id: "resource-board", use: [hidden], prompt: "hello" }),
      {
        model: "model-1",
        async prepareStep({ resources }) {
          values.push(await resources.read(board));
          await board.patch({ phase: "changed" });
          values.push(await resources.read(board));
          await expect(resources.read(undeclared)).rejects.toMatchObject({
            reason: "undeclared",
          });
        },
      },
    );

    expect(values).toEqual([{ phase: "draft" }, { phase: "draft" }]);
    expect(target.provider).toHaveBeenCalledOnce();
    const inspection = await result.steps[0]?.request?.inspect();
    expect(inspection?.preparation?.resources).toEqual([
      expect.objectContaining({
        identity: "blackboard:control-board",
        revision: expect.any(String),
        valueHash: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(inspection)).not.toContain("draft");
  });

  it("reads workingState only through the Memory that declares it", async () => {
    const storage = inMemoryStorage();
    const state = workingState({
      id: "control-state",
      schema: z.object({ phase: z.string() }),
    });
    const controlMemory = memory({
      id: "control-memory",
      namespace: "run",
      storage,
      blocks: [state],
    });
    await state.set(
      { phase: "final" },
      {
        storage,
        records: storage.records,
        vectors: storage.vectors,
        namespace: "run",
        memoryId: "control-memory",
      },
    );
    const target = createRuntime();
    let value: unknown;

    await target.runtime.generate(
      prompt({
        id: "resource-working-state",
        use: [controlMemory],
        prompt: "hello",
      }),
      {
        model: "model-1",
        async prepareStep({ resources }) {
          value = await resources.read(state);
        },
      },
    );

    expect(value).toEqual({ phase: "final" });
  });

  it("reuses the pinned Blackboard value during amendment re-resolution", async () => {
    const board = blackboard({
      id: "rendered-board",
      schema: z.object({ phase: z.string() }),
    });
    await board.patch({ phase: "draft" });
    const added = context({ id: "added-after-read", system: "Added." });
    const target = createRuntime();

    await target.runtime.generate(
      prompt({
        id: "resource-render-pin",
        use: [board],
        prompt: "hello",
      }),
      {
        model: "model-1",
        async prepareStep({ resources }) {
          expect(await resources.read(board)).toEqual({ phase: "draft" });
          await board.patch({ phase: "changed" });
          return { use: { add: [added] } };
        },
      },
    );

    const request = target.provider.mock.calls[0]?.[0] as {
      readonly system?: string;
    };
    expect(request.system).toContain('"phase": "draft"');
    expect(request.system).not.toContain("changed");
  });

  it("exposes typed content-free failures", () => {
    const error = new ResourceReadError("storage-unavailable");
    expect(error).toMatchObject({
      name: "ResourceReadError",
      reason: "storage-unavailable",
      message: "Preparation resource read failed: storage-unavailable.",
    });
  });

  it("preserves an unhandled resource reason and prevents dispatch", async () => {
    const undeclared = blackboard({
      id: "undeclared-board",
      schema: z.object({ phase: z.string() }),
    });
    const target = createRuntime();
    const error = await target.runtime
      .generate(prompt({ id: "resource-error", prompt: "hello" }), {
        model: "model-1",
        prepareStep: ({ resources }) => resources.read(undeclared).then(() => undefined),
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ResourceReadError);
    expect(error).toMatchObject({ reason: "undeclared" });
    expect(target.provider).not.toHaveBeenCalled();
  });
});
