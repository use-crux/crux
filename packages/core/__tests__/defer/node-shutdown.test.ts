import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { createNodeDeferHost } from "@use-crux/core/defer/node";

function requestPair(): {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
} {
  const request = new IncomingMessage(new Socket());
  return { request, response: new ServerResponse(request) };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe("Node defer shutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits dynamically for a running drain to complete", async () => {
    const host = createNodeDeferHost();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    const listener = host.wrap(() => {
      defer(async () => {
        started = true;
        await gate;
      });
    });
    const { request, response } = requestPair();

    listener(request, response);
    response.emit("finish");
    await flushMicrotasks();
    expect(started).toBe(true);

    const shutdown = host.shutdown();
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release?.();
    await expect(shutdown).resolves.toEqual({ completed: true, pending: 0 });
  });

  it("cancels at the fixed deadline and conservatively reports running work", async () => {
    vi.useFakeTimers();
    const host = createNodeDeferHost();
    const listener = host.wrap(() => {
      defer(() => new Promise<void>(() => {}));
    });
    const { request, response } = requestPair();

    listener(request, response);
    response.emit("finish");
    await flushMicrotasks();

    const firstShutdown = host.shutdown();
    expect(host.shutdown()).toBe(firstShutdown);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(firstShutdown).resolves.toEqual({
      completed: false,
      pending: 1,
    });
  });

  it("cancels waiting tasks and removes request/response listeners", async () => {
    vi.useFakeTimers();
    const host = createNodeDeferHost();
    const callback = vi.fn();
    const listener = host.wrap(() => {
      defer(callback);
    });
    const { request, response } = requestPair();

    listener(request, response);
    await flushMicrotasks();
    expect(response.listenerCount("finish")).toBe(1);
    expect(response.listenerCount("close")).toBe(1);
    expect(request.listenerCount("aborted")).toBe(1);

    const shutdown = host.shutdown();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(shutdown).resolves.toEqual({ completed: true, pending: 0 });
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });
});
