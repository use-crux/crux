import { afterEach, describe, expect, it, vi } from "vitest";

import { prompt } from "../../src/prompt/prompt";
import {
  connectRuntimeBridge,
  executeRuntimeBridgeCommand,
} from "../../src/runtime-bridge";
import { configure } from "../../src/runtime/configure";
import { activePromptCatalogue } from "../../src/runtime/prompt-catalogue";
import { TestWebSocket } from "./test-websocket";

describe("exact prompt preview transport lifecycle", () => {
  const disposals: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose();
    TestWebSocket.reset();
    vi.useRealTimers();
  });

  it("replaces the same peer hello when the active catalogue changes", () => {
    const first = configure({
      prompts: [prompt({ id: "first", system: "first" })],
    });
    disposals.push(first.dispose);
    const connection = connectRuntimeBridge(
      {
        devtools: {
          bridge: { connectUrl: "ws://localhost:4400/ws/runtime" },
        },
      },
      { WebSocket: TestWebSocket },
    );
    disposals.push(() => connection?.dispose());
    const socket = TestWebSocket.instance!;
    socket.open();

    const second = configure({
      prompts: [prompt({ id: "second", system: "second" })],
    });
    disposals.push(second.dispose);

    const hellos = socket.sent.map((value) => JSON.parse(value));
    expect(hellos).toHaveLength(2);
    expect(hellos[0].peer.peerId).toBe(connection?.peerId);
    expect(hellos[1]).toMatchObject({
      type: "runtime.hello",
      peer: {
        peerId: connection?.peerId,
        capabilities: [
          {
            command: "prompt.previewExact",
            targets: [{ definitionId: "prompt:second" }],
          },
        ],
      },
    });
  });

  it("cancels response ownership and discards a late inspection", async () => {
    let finish!: (value: string) => void;
    const render = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const registry = configure({
      prompts: [prompt({ id: "slow", system: render, prompt: "prompt" })],
    });
    disposals.push(registry.dispose);
    const connection = connectRuntimeBridge(
      {
        devtools: {
          bridge: { connectUrl: "ws://localhost:4400/ws/runtime" },
        },
      },
      { WebSocket: TestWebSocket },
    );
    disposals.push(() => connection?.dispose());
    const socket = TestWebSocket.instance!;
    socket.open();
    const hello = JSON.parse(socket.sent[0]!);
    const capability = hello.peer.capabilities[0];

    socket.message({
      type: "command.request",
      commandId: "cmd_slow",
      command: "prompt.previewExact",
      targetId: "prompt:slow",
      catalogueRevision: capability.catalogueRevision,
      payload: { input: {} },
      deadlineMs: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.message({
      type: "command.cancel",
      commandId: "cmd_slow",
      reason: "cancelled",
    });
    finish("late");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(render).toHaveBeenCalledTimes(1);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      expect.objectContaining({ type: "runtime.hello" }),
    ]);
  });

  it("retires an in-flight target on every catalogue replacement", async () => {
    let finish!: (value: string) => void;
    const first = configure({
      prompts: [
        prompt({
          id: "retired",
          system: () =>
            new Promise<string>((resolve) => {
              finish = resolve;
            }),
          prompt: "prompt",
        }),
      ],
    });
    disposals.push(first.dispose);
    const revision = activePromptCatalogue().revision;
    const pending = executeRuntimeBridgeCommand(
      {},
      {
        type: "command.request",
        commandId: "cmd_retired",
        command: "prompt.previewExact",
        targetId: "prompt:retired",
        catalogueRevision: revision,
        payload: { input: {} },
        deadlineMs: 1_000,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const replacement = configure({
      prompts: [prompt({ id: "replacement", system: "replacement" })],
    });
    disposals.push(replacement.dispose);

    await expect(pending).rejects.toMatchObject({
      previewError: {
        code: "target_retired",
        details: {
          expectedCatalogueRevision: revision,
          actualCatalogueRevision: revision + 1,
        },
      },
    });
    finish("late");
  });

  it("reconnects with the same peer and the current catalogue", async () => {
    vi.useFakeTimers();
    const first = configure({
      prompts: [prompt({ id: "before-reconnect", prompt: "before" })],
    });
    disposals.push(first.dispose);
    const connection = connectRuntimeBridge(
      {
        devtools: {
          bridge: {
            connectUrl: "ws://localhost:4400/ws/runtime",
            reconnect: { minMs: 10, maxMs: 10 },
          },
        },
      },
      { WebSocket: TestWebSocket },
    );
    disposals.push(() => connection?.dispose());
    const firstSocket = TestWebSocket.instance!;
    firstSocket.open();
    const replacement = configure({
      prompts: [prompt({ id: "after-reconnect", prompt: "after" })],
    });
    disposals.push(replacement.dispose);

    firstSocket.serverClose();
    await vi.advanceTimersByTimeAsync(10);
    expect(TestWebSocket.instances).toHaveLength(2);
    const secondSocket = TestWebSocket.instance!;
    secondSocket.open();
    const hello = JSON.parse(secondSocket.sent[0]!);

    expect(hello).toMatchObject({
      type: "runtime.hello",
      peer: {
        peerId: connection?.peerId,
        capabilities: [
          {
            command: "prompt.previewExact",
            targets: [{ definitionId: "prompt:after-reconnect" }],
          },
        ],
      },
    });
  });
});
