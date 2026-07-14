import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp, streamableHttp } from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const closeables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map((close) => close()));
});

describe("Streamable HTTP redirect security", () => {
  it("rejects redirects by default", async () => {
    const target = await targetFixture();
    const redirect = await startRedirectServer(target.url);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "redirect-default",
          transport: streamableHttp({
            url: redirect.url,
            headers: { Authorization: "Bearer must-not-leak" },
          }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({ phase: "connect" });

    expect(target.requestMethods).toEqual([]);
  });

  it("strips configured credentials when following cross-origin redirects", async () => {
    const target = await targetFixture();
    const redirect = await startRedirectServer(target.url);
    await expect(
      materializeMcpToolSource(
        mcp({
          id: "redirect-follow",
          transport: streamableHttp({
            url: redirect.url,
            redirect: "follow",
            headers: {
              Authorization: "Bearer must-not-leak",
              "X-API-Key": "also-must-not-leak",
            },
          }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({ phase: "connect" });

    expect(target.requestHeaders.length).toBeGreaterThan(0);
    for (const headers of target.requestHeaders) {
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    }
  });

  it("follows an opted-in same-origin redirect", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [{ tools: [] }],
      redirectFromPath: "/redirect",
    });
    closeables.push(() => fixture.close());

    const session = await materializeMcpToolSource(
      mcp({
        id: "same-origin-follow",
        transport: streamableHttp({
          url: fixture.url,
          redirect: "follow",
          headers: { "X-API-Key": "same-origin-credential" },
        }),
      }),
      { runtimeContext: undefined },
    );
    await session.close();

    expect(fixture.requestedCursors).toEqual([undefined]);
    expect(
      fixture.requestHeaders.some(
        (headers) => headers["x-api-key"] === "same-origin-credential",
      ),
    ).toBe(true);
  });
});

async function targetFixture(): Promise<McpHttpFixture> {
  const fixture = await startMcpHttpFixture({ pages: [{ tools: [] }] });
  closeables.push(() => fixture.close());
  return fixture;
}

async function startRedirectServer(
  location: string,
): Promise<{ readonly url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(307, { location });
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  closeables.push(() => closeServer(server));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Redirect fixture did not bind an IP socket.");
  }
  return { url: `http://127.0.0.1:${address.port}/mcp` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
