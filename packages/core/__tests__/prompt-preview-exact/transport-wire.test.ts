import { afterEach, describe, expect, it, vi } from "vitest";

import { prompt } from "../../src/prompt/prompt";
import { connectRuntimeBridge } from "../../src/runtime-bridge";
import { configure } from "../../src/runtime/configure";
import { activePromptCatalogue } from "../../src/runtime/prompt-catalogue";
import { TestWebSocket } from "./test-websocket";

describe("exact prompt preview WebSocket wire", () => {
  const disposals: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose();
    TestWebSocket.reset();
  });

  it("returns a closed error for an invalid preview wire request", async () => {
    open(prompt({ id: "strict", prompt: "strict" }));
    const socket = TestWebSocket.instance!;
    socket.rawMessage(
      `{"type":"command.request","commandId":"cmd_bad","command":"prompt.previewExact","targetId":"prompt:strict","catalogueRevision":1,"payload":{"input":{"secret":"first","secret":"second"}},"deadlineMs":1000}`,
    );
    await tick();

    const reply = JSON.parse(socket.sent.at(-1)!);
    expect(reply).toEqual({
      type: "command.error",
      commandId: "cmd_bad",
      error: {
        code: "invalid_request",
        message: "Exact-preview request is invalid.",
      },
    });
    expect(JSON.stringify(reply)).not.toContain("secret");
  });

  it("detects escaped preview commands without tightening legacy store JSON", async () => {
    const render = vi.fn(() => "unsafe");
    open(prompt({ id: "escaped", prompt: render }), {
      get: vi.fn(),
      list: vi.fn(async () => ({ items: [], cursor: undefined })),
    });
    const socket = TestWebSocket.instance!;
    const revision = activePromptCatalogue().revision;

    socket.rawMessage(
      `{"type":"command.request","commandId":"cmd_escaped","command":"prompt.preview\\u0045xact","targetId":"prompt:escaped","catalogueRevision":${revision},"payload":{"input":{"value":1,"value":2}},"deadlineMs":1000}`,
    );
    await tick();
    expect(render).not.toHaveBeenCalled();
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "command.error",
      commandId: "cmd_escaped",
      error: { code: "invalid_request" },
    });

    socket.rawMessage(
      `{"type":"command.request","commandId":"cmd_store","command":"store.read","payload":{"operation":"list","resource":"crux.store","prefix":"","filter":{"marker":"prompt.previewExact","marker":"legacy"}}}`,
    );
    await tick();
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "command.result",
      commandId: "cmd_store",
    });
  });

  it("replaces a non-scalar inspection error with the fixed safe message", async () => {
    open(
      prompt({
        id: "scalar-error",
        prompt: () => {
          throw new Error("\ud800private");
        },
      }),
    );
    const socket = TestWebSocket.instance!;
    socket.message({
      type: "command.request",
      commandId: "cmd_scalar",
      command: "prompt.previewExact",
      targetId: "prompt:scalar-error",
      catalogueRevision: activePromptCatalogue().revision,
      payload: { input: {} },
      deadlineMs: 1_000,
    });
    await tick();

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      error: {
        code: "inspection_failed",
        message: "Prompt inspection failed.",
      },
    });
  });

  function open(target: ReturnType<typeof prompt>, records?: unknown): void {
    const registry = configure({ prompts: [target] });
    disposals.push(registry.dispose);
    const connection = connectRuntimeBridge(
      {
        records,
        devtools: {
          bridge: { connectUrl: "ws://localhost:4400/ws/runtime" },
        },
      },
      { WebSocket: TestWebSocket },
    );
    disposals.push(() => connection?.dispose());
    TestWebSocket.instance!.open();
  }
});

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
