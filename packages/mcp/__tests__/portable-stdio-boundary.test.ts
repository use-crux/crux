import { describe, expect, it } from "vitest";

import { createAiSdkStdioTransport } from "../src/ai-sdk/stdio-portable";
import { createOfficialStdioTransport } from "../src/official-client/stdio-portable";

const stdio = { type: "stdio", command: "fixture" } as const;

describe("portable MCP stdio boundary", () => {
  it("fails closed with HTTP remediation for both client implementations", () => {
    expect(() => createAiSdkStdioTransport(stdio)).toThrow(
      /require a Node runtime.*streamableHttp/s,
    );
    expect(() => createOfficialStdioTransport(stdio)).toThrow(
      /require a Node runtime.*streamableHttp/s,
    );
  });
});
