import { afterEach, describe, expect, it } from "vitest";

import {
  McpToolSourceError,
  materializeMcpToolSource,
  mcp,
  streamableHttp,
} from "../src/index";
import { MAX_MCP_BINARY_PART_BYTES } from "../src/official-client/binary";
import { normalizeMcpToolResult } from "../src/official-client/result";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP binary content", () => {
  it("rejects malformed base64 during result normalization", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: "malformed", inputSchema: { type: "object" } }] },
      ],
      callTool: () => ({
        content: [
          { type: "image", data: "payload-secret!", mimeType: "image/png" },
        ],
      }),
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "malformed-binary",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );

    const error = await Promise.resolve(
      session.tools.malformed!.execute(
        {},
        { toolCallId: "call-1", messages: [], runtimeContext: undefined },
      ),
    ).catch((cause: unknown) => cause);
    expect(error).not.toBeInstanceOf(McpToolSourceError);
    expect(String(error)).not.toContain("payload-secret");
    await session.close();
  });

  it.each([
    ["image", imagePart],
    ["audio", audioPart],
    ["resource", resourcePart],
  ] as const)("strictly rejects malformed %s base64", (type, part) => {
    const payload = "payload-secret!";

    expect(() => normalizeMcpToolResult({ content: [part(payload)] })).toThrow(
      new RegExp(
        `content\\[0\\].*${type}.*malformed base64.*20 MiB.*${MAX_MCP_BINARY_PART_BYTES}`,
        "i",
      ),
    );
    try {
      normalizeMcpToolResult({ content: [part(payload)] });
    } catch (error) {
      expect(String(error)).not.toContain(payload);
    }
  });

  it.each(["AB==", "AAB="])(
    "rejects non-canonical padding bits in %s",
    (payload) => {
      expect(() =>
        normalizeMcpToolResult({ content: [imagePart(payload)] }),
      ).toThrow(
        new RegExp(
          `content\\[0\\].*image.*malformed base64.*20 MiB.*${MAX_MCP_BINARY_PART_BYTES}`,
          "i",
        ),
      );
    },
  );

  it.each([
    ["image", imagePart],
    ["audio", audioPart],
    ["resource", resourcePart],
  ] as const)("rejects an oversized %s before decoding", (type, part) => {
    const encoded = base64ForDecodedBytes(MAX_MCP_BINARY_PART_BYTES + 1);

    expect(() => normalizeMcpToolResult({ content: [part(encoded)] })).toThrow(
      new RegExp(
        `content\\[0\\].*${type}.*20 MiB.*${MAX_MCP_BINARY_PART_BYTES}`,
        "i",
      ),
    );
  });

  it("accepts a binary part at exactly 20 MiB", () => {
    const encoded = base64ForDecodedBytes(MAX_MCP_BINARY_PART_BYTES);

    expect(
      normalizeMcpToolResult({ content: [imagePart(encoded)] }).content[0],
    ).toMatchObject({ type: "image", data: encoded });
  });
});

function imagePart(data: string) {
  return { type: "image" as const, data, mimeType: "image/png" };
}

function audioPart(data: string) {
  return { type: "audio" as const, data, mimeType: "audio/wav" };
}

function resourcePart(blob: string) {
  return {
    type: "resource" as const,
    resource: {
      uri: "https://example.test/asset.bin",
      blob,
      mimeType: "application/octet-stream",
    },
  };
}

function base64ForDecodedBytes(byteLength: number): string {
  const completeGroups = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  return (
    "AAAA".repeat(completeGroups) +
    (remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "")
  );
}
