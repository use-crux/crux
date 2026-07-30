import { describe, expect, it } from "vitest";

import { decodePromptPreviewBrowserResponse as decodeBrowserResponse } from "../wire";

const definitionId = "prompt:writer";
const decodePromptPreviewBrowserResponse = (value: unknown) =>
  decodeBrowserResponse(value, definitionId);

const segment = (startUtf16: number, endUtf16: number) => ({
  kind: "static",
  startUtf16,
  endUtf16,
});

const ready = (inspection: Readonly<Record<string, unknown>>) => ({
  status: "ready",
  peer: {
    peerId: "peer",
    runtimeName: "App",
    environment: "node",
  },
  catalogueRevision: 4,
  inspection,
});

const inspection = (
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  system: {
    text: "",
    tokens: 0,
    coverage: "complete",
    parts: [],
  },
  totalTokens: 0,
  droppedContexts: [],
  excludedContexts: [],
  ...overrides,
});

describe("Prompt preview ready wire", () => {
  it("requires exact contiguous UTF-16 provenance reconstruction", () => {
    expect(
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            prompt: {
              text: "a😀b",
              tokens: 0,
              segments: [segment(0, 1), segment(1, 3), segment(3, 4)],
            },
          }),
        ),
      ),
    ).toMatchObject({ status: "ready" });

    for (const segments of [
      [segment(0, 1), segment(2, 4)],
      [segment(0, 3), segment(2, 4)],
      [segment(0, 2), segment(2, 4)],
      [segment(0, 3)],
    ]) {
      expect(() =>
        decodePromptPreviewBrowserResponse(
          ready(
            inspection({
              prompt: { text: "a😀b", tokens: 0, segments },
            }),
          ),
        ),
      ).toThrow();
    }
  });

  it("accepts the aggregate segment limit and rejects its overflow", () => {
    const exactText = "x".repeat(10_000);
    const exactSegments = Array.from({ length: 10_000 }, (_, index) =>
      segment(index, index + 1),
    );
    expect(
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            prompt: { text: exactText, tokens: 0, segments: exactSegments },
          }),
        ),
      ),
    ).toMatchObject({ status: "ready" });

    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            prompt: {
              text: `${exactText}x`,
              tokens: 0,
              segments: [...exactSegments, segment(10_000, 10_001)],
            },
          }),
        ),
      ),
    ).toThrow();
  });

  it("accepts exact string and array limits and rejects overflow", () => {
    const stringOverhead =
      "ready".length + definitionId.length + "partial".length;
    expect(
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: {
              text: "x".repeat(1_048_576 - stringOverhead),
              tokens: 0,
              coverage: "partial",
              parts: [],
            },
          }),
        ),
      ),
    ).toMatchObject({ status: "ready" });
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: {
              text: "x".repeat(1_048_577 - stringOverhead),
              tokens: 0,
              coverage: "partial",
              parts: [],
            },
          }),
        ),
      ),
    ).toThrow();

    const parts = Array.from({ length: 1_024 }, () => ({
      source: "s",
      text: "",
      tokens: 0,
      skipped: false,
      segments: [],
    }));
    expect(
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: { text: "", tokens: 0, coverage: "complete", parts },
          }),
        ),
      ),
    ).toMatchObject({ status: "ready" });
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: {
              text: "",
              tokens: 0,
              coverage: "complete",
              parts: [...parts, parts[0]],
            },
          }),
        ),
      ),
    ).toThrow();
  });

  it("counts every runtime string and compact result byte", () => {
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: {
              text: "x".repeat(1_048_576),
              tokens: 0,
              coverage: "partial",
              parts: [],
            },
          }),
        ),
      ),
    ).toThrow();
    const compactRuntime = (text: string) => {
      const value = inspection({
        system: {
          text,
          tokens: 0,
          coverage: "partial",
          parts: [],
        },
      });
      return {
        status: "ready",
        targetId: definitionId,
        catalogueRevision: 4,
        inspection: value,
      };
    };
    const baseBytes = new TextEncoder().encode(
      JSON.stringify(compactRuntime("")),
    ).byteLength;
    const available = 2_097_152 - baseBytes;
    const exactText =
      "\u0000".repeat(Math.floor(available / 6)) + "x".repeat(available % 6);
    expect(
      decodePromptPreviewBrowserResponse(
        ready(compactRuntime(exactText).inspection),
      ),
    ).toMatchObject({ status: "ready" });
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(compactRuntime(`${exactText}x`).inspection),
      ),
    ).toThrow();
  });

  it("derives system coverage and rejects explicit empty metadata", () => {
    const part = {
      source: "system",
      text: "Hello",
      tokens: 1,
      skipped: false,
      segments: [segment(0, 5)],
    };
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            system: {
              text: "Changed",
              tokens: 1,
              coverage: "complete",
              parts: [part],
            },
          }),
        ),
      ),
    ).toThrow();
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready(
          inspection({
            prompt: {
              text: "x",
              tokens: 0,
              segments: [{ ...segment(0, 1), source: "" }],
            },
          }),
        ),
      ),
    ).toThrow();
  });
});
