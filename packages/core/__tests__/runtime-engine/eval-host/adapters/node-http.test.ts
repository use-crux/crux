import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEvalHostClient,
  createNodeEvalHost,
} from "../../../../src/runtime/eval-host";
import {
  fixtureRegistry,
  HOST_CAPABILITIES,
  jobBody,
  NOW,
  TOKEN,
} from "../fixture";

describe("Node Eval host HTTP binding", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server === undefined) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it("serves the private client over a real in-process HTTP server", async () => {
    const registry = fixtureRegistry();
    const host = createNodeEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => NOW,
    });
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of incoming) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks);
        const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
          method: incoming.method,
          headers: nodeHeaders(incoming.headers),
          ...(body.byteLength > 0 ? { body } : {}),
        });
        const response = await host.fetch(request);
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers.entries()),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        outgoing.writeHead(500);
        outgoing.end(error instanceof Error ? error.message : String(error));
      }
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Node test server did not expose a TCP address.");
    }
    const client = createEvalHostClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: TOKEN,
    });

    await expect(client.manifest()).resolves.toMatchObject({
      hostKind: "node",
      deploymentId: "production-eu",
    });
    const body = jobBody(registry);
    await expect(client.submit(body)).resolves.toMatchObject({
      status: "accepted",
    });
    await expect(pollUntilSucceeded(client, body.jobId)).resolves.toMatchObject(
      {
        status: "succeeded",
        result: { output: { message: "Can I get a refund?" } },
      },
    );
  });
});

async function pollUntilSucceeded(
  client: ReturnType<typeof createEvalHostClient>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await client.poll(jobId);
    if (status.status !== "accepted" && status.status !== "running") {
      return status;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Eval job '${jobId}' did not become terminal.`);
}

function nodeHeaders(
  headers: import("node:http").IncomingHttpHeaders,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}
