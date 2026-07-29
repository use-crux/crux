import { describe, expect, it, vi } from "vitest";

import { createPromptLatestRunRefresh } from "./refresh";

describe("Prompt latest-Run refresh coordinator", () => {
  it("permits one background request and discards retired results", async () => {
    let resolveRequest:
      | ((value: {
          readonly status: "unavailable";
          readonly reason: "owner-not-found";
          readonly message: string;
        }) => void)
      | undefined;
    const request = vi.fn(
      (_definitionId: string, _signal?: AbortSignal) =>
        new Promise<{
          readonly status: "unavailable";
          readonly reason: "owner-not-found";
          readonly message: string;
        }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const refresh = createPromptLatestRunRefresh("prompt:greeting", request);

    const first = refresh.background();
    const second = refresh.background();
    expect(request).toHaveBeenCalledOnce();
    refresh.dispose();
    resolveRequest?.({
      status: "unavailable",
      reason: "owner-not-found",
      message: "retired",
    });

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("fresh resolution retires background work and performs a new pull", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(
        (_definitionId: string, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce({
        status: "found",
        definitionId: "prompt:greeting",
        observabilityRevision: 9,
        operationId: "operation-current",
        path: "/runs/operation-current",
      });
    const refresh = createPromptLatestRunRefresh("prompt:greeting", request);

    const background = refresh.background();
    const current = await refresh.fresh();

    expect(request).toHaveBeenCalledTimes(2);
    await expect(background).resolves.toBeUndefined();
    expect(current).toMatchObject({
      status: "found",
      operationId: "operation-current",
    });
  });
});
