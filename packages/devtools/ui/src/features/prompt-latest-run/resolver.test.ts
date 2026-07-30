import { describe, expect, it, vi } from "vitest";

import { resolvePromptLatestRun } from "./resolver";

describe("Prompt latest-Run resolver", () => {
  it("pulls once and replaces its history entry with the validated destination", async () => {
    const request = vi.fn(async () => ({
      status: "found" as const,
      definitionId: "prompt:greeting",
      observabilityRevision: 7,
      operationId: "operation-latest",
      path: "/runs/operation-latest",
    }));
    const replace = vi.fn();

    await resolvePromptLatestRun(
      "prompt:greeting",
      new AbortController().signal,
      { request, replace },
    );

    expect(request).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/runs/operation-latest");
  });

  it("does not navigate unavailable, error, aborted, or stale results", async () => {
    const replace = vi.fn();
    const controller = new AbortController();
    type EmptyResult = {
      readonly status: "empty";
      readonly definitionId: string;
      readonly observabilityRevision: number;
      readonly path: string;
      readonly exactPreview: { readonly status: "unavailable" };
    };
    let resolvePending: (result: EmptyResult) => void = () => undefined;
    const pending = new Promise<EmptyResult>((resolve) => {
      resolvePending = resolve;
    });
    const resolving = resolvePromptLatestRun(
      "prompt:greeting",
      controller.signal,
      { request: () => pending, replace },
    );
    controller.abort();
    resolvePending({
      status: "empty",
      definitionId: "prompt:greeting",
      observabilityRevision: 8,
      path: "/library/index/prompt%3Agreeting/runs",
      exactPreview: { status: "unavailable" },
    });

    await expect(resolving).resolves.toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });
});
