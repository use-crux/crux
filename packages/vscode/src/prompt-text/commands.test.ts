import { describe, expect, it, vi } from "vitest";
import { registerPromptTextCommands } from "./commands.js";

describe("registerPromptTextCommands", () => {
  it("requires an eligible active source and delegates only its primary position", async () => {
    const handlers = new Map<string, () => unknown>();
    const preview = vi.fn();
    const previewExact = vi.fn();
    const openLatestRun = vi.fn();
    const showInformation = vi.fn();
    const host = {
      registerCommand(command: string, value: () => unknown) {
        handlers.set(command, value);
        return { dispose() {} };
      },
      activeTarget: vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          source: {
            uri: "file:///repo/writer.ts",
            sourcePath: "/repo/writer.ts",
            openEpoch: 2,
            version: 7,
            sourceHash: "a".repeat(64),
            documentLength: 20,
            offsetAt: vi.fn(),
            positionAt: vi.fn(),
          },
          position: { line: 3, character: 7 },
        }),
      preview,
      previewExact,
      openLatestRun,
      showInformation,
    };

    const registrations = registerPromptTextCommands(host);
    await handlers.get("crux.promptText.previewStatic")?.();
    await handlers.get("crux.promptText.previewStatic")?.();
    await handlers.get("crux.promptText.previewExact")?.();
    await handlers.get("crux.promptText.openLatestRun")?.();

    expect(registrations).toHaveLength(3);
    expect(showInformation).toHaveBeenCalledWith(
      "Open a TypeScript or JavaScript source editor before previewing PromptText.",
    );
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file:///repo/writer.ts" }),
      { line: 3, character: 7 },
    );
    expect(previewExact).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file:///repo/writer.ts" }),
      { line: 3, character: 7 },
    );
    expect(openLatestRun).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file:///repo/writer.ts" }),
      { line: 3, character: 7 },
    );
  });
});
