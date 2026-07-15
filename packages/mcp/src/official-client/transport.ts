import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpTransportConfig } from "../index";
import { createOfficialStdioTransport } from "#official-stdio";

/** Build one fresh official-client transport for a single invocation. */
export async function createOfficialClientTransport(
  config: McpTransportConfig,
): Promise<Transport> {
  switch (config.type) {
    case "stdio": {
      return createOfficialStdioTransport(config);
    }
    case "streamable-http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          redirect: config.redirect ?? "error",
          ...(config.headers ? { headers: { ...config.headers } } : {}),
        },
        ...(config.redirect === "follow"
          ? {
              fetch: createSafeRedirectFetch(Object.keys(config.headers ?? {})),
            }
          : {}),
      });
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_HTTP_REDIRECTS = 20;
const CROSS_ORIGIN_CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "mcp-session-id",
  "proxy-authorization",
] as const;

/** Follow redirects while dropping caller credentials at an origin boundary. */
export function createSafeRedirectFetch(
  configuredHeaderNames: readonly string[],
): typeof globalThis.fetch {
  const nativeFetch = globalThis.fetch;
  return async (input, init) => {
    const initial = new Request(input, init);
    let url = new URL(initial.url);
    let method = initial.method;
    let body = init?.body;
    let headers = new Headers(initial.headers);

    for (let redirects = 0; redirects <= MAX_HTTP_REDIRECTS; redirects += 1) {
      const response = await nativeFetch(url, {
        ...init,
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
      });
      if (!REDIRECT_STATUS.has(response.status)) return response;
      if (redirects === MAX_HTTP_REDIRECTS) {
        throw new TypeError(
          `MCP HTTP redirect limit exceeded ${MAX_HTTP_REDIRECTS}.`,
        );
      }
      const location = response.headers.get("location");
      if (!location) return response;

      const nextUrl = new URL(location, url);
      if (nextUrl.origin !== url.origin) {
        for (const name of configuredHeaderNames) headers.delete(name);
        for (const name of CROSS_ORIGIN_CREDENTIAL_HEADERS) {
          headers.delete(name);
        }
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
        headers.delete("content-length");
        headers.delete("content-type");
      }
      url = nextUrl;
    }

    throw new TypeError("Unreachable MCP HTTP redirect state.");
  };
}
