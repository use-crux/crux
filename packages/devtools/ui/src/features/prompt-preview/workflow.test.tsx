import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pathFromState, stateFromPath } from "@/app/navigation/useNavigation";
import { PromptPreviewState } from "./states";
import { createPromptPreviewWorkflow } from "./workflow";

describe("Prompt exact-preview workflow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens unavailable without dispatch and executes only after Preview", async () => {
    const definitionId = "prompt:billing/support";
    expect(
      stateFromPath("/library/index/prompt/prompt%3Abilling%2Fsupport/preview"),
    ).toEqual({ view: "prompt-preview", definitionId });
    expect(pathFromState({ view: "prompt-preview", definitionId })).toBe(
      "/library/index/prompt/prompt%3Abilling%2Fsupport/preview",
    );

    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4400" } });
    let available = false;
    let dispatches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          dispatches += 1;
          return Response.json({
            status: "ready",
            peer: {
              peerId: "peer-1",
              runtimeName: "app",
              environment: "node",
            },
            catalogueRevision: 7,
            inspection: {
              system: {
                text: "",
                tokens: 0,
                coverage: "complete",
                parts: [],
              },
              totalTokens: 0,
              droppedContexts: [],
              excludedContexts: [],
            },
          });
        }
        return Response.json(
          available
            ? {
                status: "ready",
                projectionRevision: 2,
                owner: {
                  definitionId,
                  kind: "prompt",
                  name: "billing-support",
                },
                choices: [
                  {
                    peerId: "peer-1",
                    runtimeName: "app",
                    environment: "node",
                    catalogueRevision: 7,
                    target: {
                      name: "billing-support",
                      input: { mode: "raw" },
                    },
                  },
                ],
              }
            : {
                status: "unavailable",
                projectionRevision: 1,
                reason: "no-peer",
                message: "No live runtime peer is available.",
              },
        );
      }),
    );

    const workflow = createPromptPreviewWorkflow(definitionId);
    await workflow.refresh();
    expect(dispatches).toBe(0);
    expect(
      renderToStaticMarkup(<PromptPreviewState state={workflow.snapshot()} />),
    ).toContain("No live runtime peer is available.");

    available = true;
    await workflow.refresh();
    workflow.setRawText('{"customer":"Ada"}');
    expect(workflow.snapshot().canPreview).toBe(true);
    expect(dispatches).toBe(0);

    await workflow.preview();
    expect(dispatches).toBe(1);
    expect(workflow.snapshot().phase).toBe("ready");
  });
});
