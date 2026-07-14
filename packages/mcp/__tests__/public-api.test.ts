import { describe, expect, it } from "vitest";

import { mcp, stdio, streamableHttp } from "../src";

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
});
