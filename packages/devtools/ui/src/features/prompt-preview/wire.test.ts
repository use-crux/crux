import { describe, expect, it } from "vitest";

import {
  decodePromptPreviewBrowserResponse as decodeBrowserResponse,
  decodePromptPreviewDiscovery,
} from "./wire";

const decodePromptPreviewBrowserResponse = (value: unknown) =>
  decodeBrowserResponse(value, "prompt:writer");

describe("Prompt preview strict browser wire", () => {
  const readyDiscovery = {
    status: "ready",
    projectionRevision: 2,
    owner: {
      definitionId: "prompt:writer",
      kind: "prompt",
      name: "Writer",
    },
    choices: [
      {
        peerId: "peer",
        runtimeName: "App",
        environment: "node",
        catalogueRevision: 4,
        target: { name: "Writer", input: { mode: "raw" } },
      },
    ],
  };

  it("decodes exact discovery and rejects unknown nested fields", () => {
    expect(decodePromptPreviewDiscovery(readyDiscovery)).toEqual(
      readyDiscovery,
    );
    expect(() =>
      decodePromptPreviewDiscovery({
        ...readyDiscovery,
        choices: [
          {
            ...readyDiscovery.choices[0],
            target: {
              ...readyDiscovery.choices[0]!.target,
              privateCallback: "hidden",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("decodes exact ready response and rejects bridge-private fields", () => {
    const ready = {
      status: "ready",
      peer: {
        peerId: "peer",
        runtimeName: "App",
        environment: "node",
      },
      catalogueRevision: 4,
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
    };
    expect(decodePromptPreviewBrowserResponse(ready)).toEqual(ready);
    expect(() =>
      decodePromptPreviewBrowserResponse({ ...ready, commandId: "private" }),
    ).toThrow();
    expect(() =>
      decodePromptPreviewBrowserResponse({
        ...ready,
        peer: { ...ready.peer, endpointUrl: "http://private" },
      }),
    ).toThrow();
  });

  it("requires validation clear arrays and the closed error code union", () => {
    expect(
      decodePromptPreviewBrowserResponse({
        status: "validation-error",
        catalogueRevision: 4,
        issues: [],
        omittedIssueCount: 0,
      }),
    ).toMatchObject({ status: "validation-error", issues: [] });
    expect(() =>
      decodePromptPreviewBrowserResponse({
        status: "error",
        code: "target_retired",
        message: "compatibility value",
      }),
    ).toThrow();
  });
});
