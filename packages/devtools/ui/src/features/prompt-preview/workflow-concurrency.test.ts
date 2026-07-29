import { afterEach, describe, expect, it, vi } from "vitest";

import { createPromptPreviewWorkflow } from "./workflow";

const choice = (revision: number) => ({
  peerId: "peer",
  runtimeName: "App",
  environment: "node" as const,
  catalogueRevision: revision,
  target: { name: "Writer", input: { mode: "raw" as const } },
});

const discovery = (revision: number): Response =>
  Response.json({
    status: "ready",
    projectionRevision: revision,
    owner: {
      definitionId: "prompt:writer",
      kind: "prompt",
      name: "Writer",
    },
    choices: [choice(revision)],
  });

describe("Prompt preview workflow concurrency", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a fresh error refresh when older discovery is pending", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let gets = 0;
    let posts = 0;
    let finishStaleDiscovery!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts += 1;
          return Promise.resolve(
            Response.json({
              status: "error",
              code: "catalogue_changed",
              message: "The runtime Prompt catalogue changed.",
            }),
          );
        }
        gets += 1;
        if (gets === 2) {
          return new Promise<Response>((resolve) => {
            finishStaleDiscovery = resolve;
          });
        }
        return Promise.resolve(discovery(gets === 1 ? 1 : 2));
      }),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    const staleDiscovery = workflow.refresh();
    const pendingPreview = workflow.preview();
    await vi.waitFor(() => expect(posts).toBe(1));
    finishStaleDiscovery(discovery(1));
    await Promise.all([staleDiscovery, pendingPreview]);

    expect(gets).toBe(3);
    expect(posts).toBe(1);
    expect(workflow.snapshot().selected?.catalogueRevision).toBe(2);
    expect(workflow.snapshot().result).toBeUndefined();
  });

  it("retires discovery started during a failing dispatch", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let gets = 0;
    let finishDispatch!: (response: Response) => void;
    let finishConcurrentDiscovery!: (response: Response) => void;
    let concurrentSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            finishDispatch = resolve;
          });
        }
        gets += 1;
        if (gets === 2) {
          concurrentSignal = init?.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            finishConcurrentDiscovery = resolve;
          });
        }
        return Promise.resolve(discovery(gets === 1 ? 1 : 2));
      }),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    const pendingPreview = workflow.preview();
    const concurrentDiscovery = workflow.refresh();
    finishDispatch(
      Response.json({
        status: "error",
        code: "catalogue_changed",
        message: "The runtime Prompt catalogue changed.",
      }),
    );
    await vi.waitFor(() => expect(gets).toBe(3));
    finishConcurrentDiscovery(discovery(1));
    await Promise.all([pendingPreview, concurrentDiscovery]);

    expect(concurrentSignal?.aborted).toBe(true);
    expect(workflow.snapshot().selected?.catalogueRevision).toBe(2);
    expect(workflow.snapshot().result).toBeUndefined();
  });

  it("retires an active dispatch when its tuple disappears", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let revision = 1;
    let finishDispatch!: (response: Response) => void;
    let dispatchSignal: AbortSignal | undefined;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts += 1;
          dispatchSignal = init.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            finishDispatch = resolve;
          });
        }
        return Promise.resolve(discovery(revision));
      }),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    const pending = workflow.preview();
    expect(workflow.snapshot().phase).toBe("running");

    revision = 2;
    await workflow.refresh();
    expect(dispatchSignal?.aborted).toBe(true);
    expect(workflow.snapshot().phase).toBe("input");
    expect(workflow.snapshot().selected).toBeUndefined();
    expect(workflow.snapshot().result).toBeUndefined();

    finishDispatch(
      Response.json({
        status: "ready",
        peer: {
          peerId: "peer",
          runtimeName: "App",
          environment: "node",
        },
        catalogueRevision: 1,
        inspection: {
          system: { text: "", tokens: 0, coverage: "complete", parts: [] },
          totalTokens: 0,
          droppedContexts: [],
          excludedContexts: [],
        },
      }),
    );
    await pending;
    expect(posts).toBe(1);
    expect(workflow.snapshot().result).toBeUndefined();
  });
});
