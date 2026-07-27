import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import {
  discoverProjectEvals,
  fingerprintDeployedEvalCase,
  hydrateEvalCases,
  projectEvalExecutionArms,
  projectDeployedEvalRequiredHostCapabilities,
  projectDeployedEvalVariants,
} from "@use-crux/core/eval/internal/node-runner";
import { createNodeEvalHost } from "@use-crux/core/runtime/internal/eval-host";
import { createDeployedEvalRegistry } from "@use-crux/core/runtime/internal/eval-registry";

export interface TestEvalHost {
  readonly url: string;
  readonly deploymentId: string;
  readonly token: string;
  readonly requests: Readonly<{ manifest: number; jobs: number }>;
  close(): Promise<void>;
}

/** Start the real Node Runtime host around the fixture project's deployed Eval. */
export async function startTestEvalHost(
  projectRoot: string,
  deploymentId = "production",
): Promise<TestEvalHost> {
  const discovery = await discoverProjectEvals(projectRoot);
  const discovered = discovery.evals.find((entry) => entry.id === "remote");
  if (discovery.errors.length > 0 || discovered === undefined) {
    throw new Error("The remote Eval fixture could not be discovered.");
  }
  const entry = await hydrateEvalCases(discovered, { projectRoot });
  const requiredHostCapabilities = projectDeployedEvalRequiredHostCapabilities(
    entry.eval,
  );
  const registry = createDeployedEvalRegistry({
    entries: [
      {
        eval: entry.eval,
        id: entry.id,
        source: entry.sourceKey.relativeFile,
        evalFingerprint: entry.definitionFingerprint,
        cases: entry.cases.map((item) => ({
          id: item.id,
          authored: item.authored,
          fingerprint: fingerprintDeployedEvalCase(
            entry.eval,
            item.id,
            item.authored,
          ),
        })),
        variants: projectDeployedEvalVariants(entry.eval),
        runtimeArms: projectEvalExecutionArms(entry.eval).flatMap((arm) =>
          arm.status === "ready" && arm.execution === "runtime"
            ? [
                {
                  name: arm.name,
                  requiredHostCapabilities: arm.requiredHostCapabilities,
                },
              ]
            : [],
        ),
        requiredHostCapabilities,
        index: {
          id: entry.id,
          source: entry.sourceKey.relativeFile,
          requiredHostCapabilities,
        },
      },
    ],
  });
  const token = "phase-23-test-token-at-least-32-bytes";
  const host = createNodeEvalHost({
    deploymentId,
    token,
    registry,
    hostCapabilities: requiredHostCapabilities,
  });
  const counts = { manifest: 0, jobs: 0 };
  const server = createServer(async (incoming, outgoing) => {
    const pathname = new URL(incoming.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/manifest") counts.manifest += 1;
    if (pathname === "/jobs") counts.jobs += 1;
    const chunks: Uint8Array[] = [];
    for await (const chunk of incoming) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);
    const response = await host.fetch(
      new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers: nodeHeaders(incoming.headers),
        ...(body.byteLength > 0 ? { body } : {}),
      }),
    );
    outgoing.writeHead(
      response.status,
      Object.fromEntries(response.headers.entries()),
    );
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The Eval host fixture did not expose a TCP port.");
  }
  return Object.freeze({
    url: `http://127.0.0.1:${address.port}`,
    deploymentId,
    token,
    requests: counts,
    close: () => close(server),
  });
}

function nodeHeaders(headers: IncomingHttpHeaders): Headers {
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

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
