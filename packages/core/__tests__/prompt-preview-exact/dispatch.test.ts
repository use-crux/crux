import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { promptDefinitionRef } from "../../src/observability/definition-ref";
import { context, when } from "../../src/prompt/context";
import { prompt } from "../../src/prompt/prompt";
import { md } from "../../src/prompt-text";
import {
  droppable,
  summarizable,
} from "../../src/request/representation/wrappers";
import { configure } from "../../src/runtime/configure";
import {
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
} from "../../src/runtime-bridge";

describe("exact prompt preview dispatch", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  it("advertises a canonical target and previews only after explicit dispatch", async () => {
    const transform = vi.fn((value: string) => value.trim());
    const render = vi.fn(
      ({ input }: { input: { readonly name: string } }) =>
        md`Hello, ${input.name}!`,
    );
    const greeting = prompt({
      id: "greeting",
      input: z.object({ name: z.string().transform(transform) }),
      system: "You are concise.",
      prompt: render,
    });
    const registry = configure({ prompts: [greeting] });
    dispose = registry.dispose;

    const manifest = getRuntimeBridgeManifest({
      devtools: { bridge: true },
    });
    const capability = manifest?.capabilities.find(
      (candidate) => candidate.command === "prompt.previewExact",
    );
    const targetId = promptDefinitionRef(greeting.id).id;

    expect(capability).toEqual({
      command: "prompt.previewExact",
      catalogueRevision: expect.any(Number),
      targets: [
        {
          definitionId: targetId,
          kind: "prompt",
          name: "greeting",
          input: {
            mode: "schema",
            schema: expect.any(Object),
          },
        },
      ],
    });
    expect(transform).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    if (
      capability?.command !== "prompt.previewExact" ||
      capability.catalogueRevision === undefined
    ) {
      throw new Error("expected exact-preview capability");
    }
    const result = await executeRuntimeBridgeCommand(
      { devtools: { bridge: true } },
      {
        type: "command.request",
        commandId: "cmd_preview",
        command: "prompt.previewExact",
        targetId,
        catalogueRevision: capability.catalogueRevision,
        payload: { input: { name: "  Ada  " } },
        deadlineMs: 1_000,
      },
    );

    expect(transform).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "ready",
      targetId,
      catalogueRevision: capability.catalogueRevision,
      preview: {
        status: "fits",
        model: "unknown",
        measurement: "conservative",
        adaptations: [],
      },
    });
    expect(result).not.toHaveProperty("runIds");
    expect(result).not.toHaveProperty("traceIds");
  });

  it("rejects fields for a none-input target before invoking application code", async () => {
    const render = vi.fn(() => "unsafe");
    const target = prompt({ id: "none-input", prompt: render });
    const registry = configure({ prompts: [target] });
    dispose = registry.dispose;
    const revision = getPreviewRevision();

    await expect(
      executeRuntimeBridgeCommand(
        {},
        {
          type: "command.request",
          commandId: "cmd_none_input",
          command: "prompt.previewExact",
          targetId: "prompt:none-input",
          catalogueRevision: revision,
          payload: { input: { unexpected: true } },
          deadlineMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({
      previewError: { code: "invalid_request" },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("fails closed when a validation issue cannot fit the public schema", async () => {
    const target = prompt({
      id: "hostile-validation",
      input: z.object({
        value: z.string().min(1, "private-".repeat(200)),
      }),
      prompt: "safe",
    });
    const registry = configure({ prompts: [target] });
    dispose = registry.dispose;

    await expect(
      executeRuntimeBridgeCommand(
        {},
        {
          type: "command.request",
          commandId: "cmd_hostile",
          command: "prompt.previewExact",
          targetId: "prompt:hostile-validation",
          catalogueRevision: getPreviewRevision(),
          payload: { input: { value: "" } },
          deadlineMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({
      previewError: {
        code: "inspection_failed",
        message: "Prompt inspection failed.",
      },
    });
  });

  it("times out without publishing a late callback result", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const slow = context({
      id: "slow-context",
      system: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const target = prompt({
      id: "timeout",
      use: [slow],
      prompt: "unreached",
    });
    const registry = configure({ prompts: [target] });
    dispose = registry.dispose;
    const pending = executeRuntimeBridgeCommand(
      {},
      {
        type: "command.request",
        commandId: "cmd_timeout",
        command: "prompt.previewExact",
        targetId: "prompt:timeout",
        catalogueRevision: getPreviewRevision(),
        payload: { input: {} },
        deadlineMs: 10,
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      previewError: { code: "inspection_timeout" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    finish("late");
  });

  it("measures provider adaptation, contexts, budget, and tools without execution", async () => {
    const executeTool = vi.fn(() => "never");
    const kept = context({
      id: "kept",
      system: "Kept context.",
      tools: {
        lookup: {
          description: "Lookup",
          parameters: z.object({}),
          execute: executeTool,
        },
      },
    });
    const excluded = when(
      () => false,
      context({ id: "excluded", system: "Excluded context." }),
    );
    const sticky = context({ id: "sticky", system: "Sticky context." });
    const elastic = context({ id: "elastic", system: "Elastic context." });
    const target = prompt({
      id: "full-projection",
      system: "Base system.",
      prompt: "Question.",
      use: [kept, summarizable(sticky), droppable(elastic), excluded],
      adapt: {
        openai: { appendSystem: "Provider tail." },
      },
    });
    const registry = configure({ prompts: [target] });
    dispose = registry.dispose;

    const result = await executeRuntimeBridgeCommand(
      {},
      {
        type: "command.request",
        commandId: "cmd_projection",
        command: "prompt.previewExact",
        targetId: "prompt:full-projection",
        catalogueRevision: getPreviewRevision(),
        payload: {
          input: {},
          options: {
            provider: "openai",
            modelId: "gpt-test",
          },
        },
        deadlineMs: 1_000,
      },
    );

    expect(result).toMatchObject({
      status: "ready",
      preview: {
        status: "fits",
        model: "gpt-test",
        measurement: "conservative",
        adaptations: [],
        inputTokens: expect.any(Number),
      },
      contributions: expect.arrayContaining([
        expect.objectContaining({ id: "context:kept", boundary: "required" }),
        expect.objectContaining({ id: "sticky", boundary: "sticky" }),
        expect.objectContaining({ id: "elastic", boundary: "elastic" }),
      ]),
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  function getPreviewRevision(): number {
    const capability = getRuntimeBridgeManifest({
      devtools: { bridge: true },
    })?.capabilities.find(
      (candidate) => candidate.command === "prompt.previewExact",
    );
    if (
      capability?.command !== "prompt.previewExact" ||
      capability.catalogueRevision === undefined
    ) {
      throw new Error("expected exact-preview capability");
    }
    return capability.catalogueRevision;
  }
});
