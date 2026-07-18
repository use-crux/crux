import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { createNodeDeferHost, node } from "@use-crux/core/defer/node";
import { classifyNodeOutcome } from "../../src/defer/node/host";
import {
  createInMemoryObservabilityTransport,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";

function requestPair(): {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
} {
  const request = new IncomingMessage(new Socket());
  return { request, response: new ServerResponse(request) };
}

describe("Node defer host", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetObservabilityRuntime();
  });

  it("declares a non-ambient process-lifetime binding", () => {
    const binding = node();

    expect(binding).toMatchObject({
      kind: "node",
      invocationScope: false,
      supportsInline: true,
    });
    expect(() => binding.retain(async () => {})).not.toThrow();
  });

  it("flushes response-finished deferred evidence before shutdown completes", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 });
    const host = createNodeDeferHost();
    const listener = host.wrap((_request, _response) => {
      defer(() => {});
    });
    const { request, response } = requestPair();

    listener(request, response);
    response.emit("finish");

    await expect(host.shutdown()).resolves.toEqual({
      completed: true,
      pending: 0,
    });
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive === "defer.run",
      ),
    ).toBe(true);
  });

  it.each([
    ["finish", "close"],
    ["close", "finish"],
  ] as const)(
    "returns void and starts cleanup once on %s followed by %s",
    async (firstEvent, secondEvent) => {
      const host = createNodeDeferHost();
      const callback = vi.fn();
      const listener = host.wrap((_request, _response) => {
        defer(callback);
      });
      const { request, response } = requestPair();

      expect(listener(request, response)).toBeUndefined();
      expect(callback).not.toHaveBeenCalled();

      response.emit(firstEvent);
      response.emit(secondEvent);

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledOnce();
      });
      await expect(host.shutdown()).resolves.toEqual({
        completed: true,
        pending: 0,
      });
    },
  );

  it("passes exact handler failures to a custom error hook and classifier", async () => {
    const host = createNodeDeferHost();
    const thrown = new Error("handler failed");
    const onError = vi.fn(async () => {});
    const classifyOutcome = vi.fn(() => "redirect" as const);
    const listener = host.wrap(
      () => {
        throw thrown;
      },
      { onError, classifyOutcome },
    );
    const { request, response } = requestPair();

    listener(request, response);
    response.emit("close");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(thrown, { request, response });
    });
    expect(classifyOutcome).toHaveBeenCalledWith({
      request,
      response,
      settlement: { kind: "thrown", error: thrown },
    });
  });

  it("does not miss a response that was already terminal before scheduling", async () => {
    const host = createNodeDeferHost();
    const callback = vi.fn();
    const listener = host.wrap(() => {
      defer(callback);
    });
    const { request, response } = requestPair();
    Object.defineProperty(response, "writableFinished", { value: true });

    listener(request, response);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledOnce();
    });
    await expect(host.shutdown()).resolves.toEqual({
      completed: true,
      pending: 0,
    });
  });

  it("classifies only observable abort state and never response status", () => {
    const ordinary = requestPair();
    ordinary.response.statusCode = 404;
    expect(
      classifyNodeOutcome(
        ordinary.request,
        ordinary.response,
        { kind: "returned", value: undefined },
        undefined,
      ),
    ).toBe("success");
    expect(
      classifyNodeOutcome(
        ordinary.request,
        ordinary.response,
        { kind: "thrown", error: new Error("ordinary") },
        undefined,
      ),
    ).toBe("error");

    const aborted = requestPair();
    Object.defineProperty(aborted.request, "aborted", { value: true });
    expect(
      classifyNodeOutcome(
        aborted.request,
        aborted.response,
        { kind: "thrown", error: new Error("aborted") },
        undefined,
      ),
    ).toBe("cancelled");
  });

  it("falls back to a 500 response when a custom error hook rejects", async () => {
    const host = createNodeDeferHost();
    const thrown = new Error("primary failure");
    const listener = host.wrap(
      () => {
        throw thrown;
      },
      {
        onError: async () => {
          throw new Error("secondary hook failure");
        },
      },
    );
    const { request, response } = requestPair();
    const end = vi.spyOn(response, "end").mockReturnValue(response);

    listener(request, response);
    await vi.waitFor(() => {
      expect(end).toHaveBeenCalledOnce();
    });
    expect(response.statusCode).toBe(500);

    response.emit("close");
    await expect(host.shutdown()).resolves.toEqual({
      completed: true,
      pending: 0,
    });
  });

  it("destroys an already-started response with the original Error", async () => {
    const host = createNodeDeferHost();
    const thrown = new Error("late handler failure");
    const listener = host.wrap(() => {
      throw thrown;
    });
    const { request, response } = requestPair();
    Object.defineProperty(response, "headersSent", { value: true });
    const destroy = vi.spyOn(response, "destroy").mockReturnValue(response);

    listener(request, response);
    await vi.waitFor(() => {
      expect(destroy).toHaveBeenCalledWith(thrown);
    });
    response.emit("close");
    await expect(host.shutdown()).resolves.toEqual({
      completed: true,
      pending: 0,
    });
  });
});
