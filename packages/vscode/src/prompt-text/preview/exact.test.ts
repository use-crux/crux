import { describe, expect, it, vi } from "vitest";
import { openPromptTextExactPreview } from "./exact.js";
import type { PromptTextPreviewSource } from "./types.js";

const source: PromptTextPreviewSource = {
  uri: "file:///workspace/prompt.ts",
  sourcePath: "/workspace/prompt.ts",
  openEpoch: 2,
  version: 3,
  sourceHash: "hash",
  documentLength: 0,
  offsetAt: () => undefined,
  positionAt: () => undefined,
};

const ready = {
  kind: "ready",
  url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/preview",
};

describe("VS Code exact Prompt preview operation", () => {
  it("opens only a current, strictly validated Local result", async () => {
    const client = { sendRequest: vi.fn(async () => ready) };
    const openExternal = vi.fn(async () => undefined);
    const showInformation = vi.fn();

    await openPromptTextExactPreview(
      {
        client: () => client,
        currentSource: () => source,
        configuredPort: () => 4400,
        openExternal,
        showInformation,
      },
      source,
      { line: 1, character: 2 },
    );

    expect(client.sendRequest).toHaveBeenCalledWith(
      "crux/promptText/previewExactLink",
      {
        uri: source.uri,
        openEpoch: source.openEpoch,
        version: source.version,
        sourceHash: source.sourceHash,
        position: { line: 1, character: 2 },
      },
    );
    expect(openExternal).toHaveBeenCalledWith(ready.url);
    expect(showInformation).not.toHaveBeenCalled();
  });

  it("silently retires responses after source or client replacement", async () => {
    let currentClient: { sendRequest(): Promise<unknown> } | undefined;
    let resolve!: (value: unknown) => void;
    const client = {
      sendRequest: (): Promise<unknown> =>
        new Promise((done) => {
          resolve = done as (value: unknown) => void;
        }),
    };
    currentClient = client;
    const openExternal = vi.fn(async () => undefined);
    const showInformation = vi.fn();
    const pending = openPromptTextExactPreview(
      {
        client: () => currentClient,
        currentSource: () => ({ ...source, version: 4 }),
        configuredPort: () => 4400,
        openExternal,
        showInformation,
      },
      source,
      { line: 0, character: 0 },
    );
    currentClient = undefined;
    resolve(ready);
    await pending;

    expect(openExternal).not.toHaveBeenCalled();
    expect(showInformation).not.toHaveBeenCalled();
  });
});
