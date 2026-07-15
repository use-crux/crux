import { describe, expect, it } from "vitest";

import { McpConfigurationError, mcp, stdio, streamableHttp } from "../src";

describe("MCP definitions", () => {
  it("copies and freezes retained transport and selection values", () => {
    const args = ["fixture.mjs"];
    const env = { FIXTURE_TOKEN: "synthetic" };
    const allow = ["lookup"];
    const headers = { Authorization: "Bearer synthetic" };

    const stdioTransport = stdio({ command: "node", args, env });
    const httpTransport = streamableHttp({
      url: "https://mcp.example.test",
      headers,
    });
    const source = mcp({
      id: "fixture",
      transport: stdioTransport,
      tools: { allow, prefix: "fixture_" },
    });

    args.push("--mutated");
    env.FIXTURE_TOKEN = "mutated";
    allow.push("mutated");
    headers.Authorization = "mutated";

    expect(stdioTransport.args).toEqual(["fixture.mjs"]);
    expect(stdioTransport.env).toEqual({ FIXTURE_TOKEN: "synthetic" });
    expect(httpTransport.headers).toEqual({
      Authorization: "Bearer synthetic",
    });
    expect(source.tools).toEqual({
      allow: ["lookup"],
      prefix: "fixture_",
    });
    expect(
      [
        source,
        source.tools,
        source.tools?.allow,
        stdioTransport,
        stdioTransport.args,
        stdioTransport.env,
        httpTransport,
        httpTransport.headers,
      ].every((value) => value === undefined || Object.isFrozen(value)),
    ).toBe(true);
  });

  it("rejects empty IDs and allow/deny conflicts at runtime", () => {
    const transport = stdio({ command: "fixture-server" });

    expect(() => mcp({ id: "  ", transport })).toThrow(
      "mcp(): id must be non-empty",
    );
    expect(() =>
      Reflect.apply(mcp, undefined, [
        {
          id: "fixture",
          transport,
          tools: { allow: ["read"], deny: ["write"] },
        },
      ]),
    ).toThrow("mcp(): tools.allow and tools.deny are mutually exclusive");
  });

  it.each([
    ["stdio command", () => stdio({ command: 42 } as never), "command"],
    [
      "stdio discriminant",
      () => stdio({ type: "websocket", command: "node" } as never),
      "type",
    ],
    [
      "stdio arguments",
      () => stdio({ command: "node", args: ["ok", 42] } as never),
      "args[1]",
    ],
    [
      "stdio environment",
      () => stdio({ command: "node", env: { TOKEN: 42 } } as never),
      "env.TOKEN",
    ],
    ["HTTP URL", () => streamableHttp({ url: 42 } as never), "url"],
    [
      "HTTP discriminant",
      () =>
        streamableHttp({
          type: "websocket",
          url: "https://mcp.example.test",
        } as never),
      "type",
    ],
    [
      "HTTP headers",
      () =>
        streamableHttp({
          url: "https://mcp.example.test",
          headers: { Authorization: 42 },
        } as never),
      "headers.Authorization",
    ],
    [
      "HTTP redirect",
      () =>
        streamableHttp({
          url: "https://mcp.example.test",
          redirect: "manual",
        } as never),
      "redirect",
    ],
    [
      "transport discriminant",
      () =>
        mcp({
          id: "fixture",
          transport: { type: "websocket", url: "opaque-value" },
        } as never),
      "transport.type",
    ],
    [
      "selection entry",
      () =>
        mcp({
          id: "fixture",
          transport: stdio({ command: "node" }),
          tools: { allow: ["lookup", 42] },
        } as never),
      "tools.allow[1]",
    ],
    [
      "selection prefix",
      () =>
        mcp({
          id: "fixture",
          transport: stdio({ command: "node" }),
          tools: { prefix: 42 },
        } as never),
      "tools.prefix",
    ],
  ])("rejects an invalid %s with structured safe context", (_, run, field) => {
    let error: unknown;
    try {
      run();
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(McpConfigurationError);
    expect(error).toMatchObject({
      code: "MCP_CONFIGURATION_ERROR",
      field,
    });
    expect(String(error)).not.toContain("opaque-value");
  });
});
