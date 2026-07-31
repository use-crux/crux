import { afterEach, describe, expect, it, vi } from "vitest";

import { createPromptPreviewWorkflow } from "./workflow";

const choice = (revision: number, peerId = "peer") => ({
  peerId,
  runtimeName: "App",
  environment: "node" as const,
  catalogueRevision: revision,
  target: { name: "Writer", input: { mode: "raw" as const } },
});

describe("Prompt preview workflow lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit selection for multiple choices", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ready",
          projectionRevision: 1,
          owner: {
            definitionId: "prompt:writer",
            kind: "prompt",
            name: "Writer",
          },
          choices: [choice(1, "a"), choice(1, "b")],
        }),
      ),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    expect(workflow.snapshot().selected).toBeUndefined();
    expect(workflow.snapshot().canPreview).toBe(false);
    workflow.select(choice(1, "b"));
    expect(workflow.snapshot().selected?.peerId).toBe("b");
    expect(workflow.snapshot().canPreview).toBe(true);
  });

  it("rejects authored input for no-input targets and canonical overflow", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ready",
          projectionRevision: 1,
          owner: {
            definitionId: "prompt:writer",
            kind: "prompt",
            name: "Writer",
          },
          choices: [
            {
              ...choice(1),
              target: { name: "Writer", input: { mode: "none" } },
            },
          ],
        }),
      ),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    expect(workflow.snapshot().canPreview).toBe(true);

    workflow.setRawText('{"unexpected":true}');
    expect(workflow.snapshot().canPreview).toBe(false);

    workflow.setRawText(`{"text":"${"\\u0000".repeat(44_000)}"}`);
    expect(workflow.snapshot().canPreview).toBe(false);
  });

  it("coalesces discovery and drops stale or disposed outcomes", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let resolve!: (response: Response) => void;
    let discoverySignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((done) => {
          discoverySignal = init?.signal ?? undefined;
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    const first = workflow.refresh();
    const second = workflow.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    workflow.dispose();
    expect(discoverySignal?.aborted).toBe(true);
    resolve(
      Response.json({
        status: "unavailable",
        projectionRevision: 1,
        reason: "no-peer",
        message: "No live runtime peer is available.",
      }),
    );
    await Promise.all([first, second]);
    expect(workflow.snapshot().phase).toBe("idle");
  });

  it("clears selection/result on revision change and never replays", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let revision = 1;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts += 1;
          return Response.json({
            status: "ready",
            peer: {
              peerId: "peer",
              runtimeName: "App",
              environment: "node",
            },
            catalogueRevision: revision,
            preview: {
              status: "fits",
              measurement: "exact",
              adaptations: [],
              warnings: [],
              diagnostics: [],
            },
            contributions: [],
          });
        }
        return Response.json({
          status: "ready",
          projectionRevision: revision,
          owner: {
            definitionId: "prompt:writer",
            kind: "prompt",
            name: "Writer",
          },
          choices: [choice(revision)],
        });
      }),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();
    await workflow.preview();
    expect(posts).toBe(1);
    expect(workflow.snapshot().result?.status).toBe("ready");

    revision = 2;
    await workflow.refresh();
    expect(posts).toBe(1);
    expect(workflow.snapshot().result).toBeUndefined();
    expect(workflow.snapshot().selected?.catalogueRevision).toBe(2);
  });

  it("refreshes stale runtime failures without replaying dispatch", async () => {
    vi.stubGlobal("window", { location: { origin: "http://local.test" } });
    let revision = 1;
    let gets = 0;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts += 1;
          revision = 2;
          return Response.json({
            status: "error",
            code: "catalogue_changed",
            message: "The runtime Prompt catalogue changed.",
          });
        }
        gets += 1;
        return Response.json({
          status: "ready",
          projectionRevision: revision,
          owner: {
            definitionId: "prompt:writer",
            kind: "prompt",
            name: "Writer",
          },
          choices: [choice(revision)],
        });
      }),
    );
    const workflow = createPromptPreviewWorkflow("prompt:writer");
    await workflow.refresh();

    await workflow.preview();

    expect(posts).toBe(1);
    expect(gets).toBe(2);
    expect(workflow.snapshot().selected?.catalogueRevision).toBe(2);
    expect(workflow.snapshot().result).toBeUndefined();
  });
});
