import { describe, expect, it, vi } from "vitest";
import { openPromptTextLatestRun } from "./latest.js";
import type { PromptTextPreviewSource } from "./preview/types.js";

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
  url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/latest-run",
} as const;

describe("VS Code latest PromptText Run operation", () => {
  it("opens only a current, strictly validated Local resolver result", async () => {
    const client = { sendRequest: vi.fn(async () => ready) };
    const openExternal = vi.fn(async () => undefined);
    const showInformation = vi.fn();

    await openPromptTextLatestRun(
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
      "crux/promptText/openLatestRunLink",
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
    const pending = openPromptTextLatestRun(
      {
        client: () => currentClient,
        currentSource: () => ({ ...source, sourceHash: "changed" }),
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
