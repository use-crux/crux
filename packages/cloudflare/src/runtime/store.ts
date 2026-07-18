import type { EvalHostStore } from "@use-crux/core/runtime/internal/eval-host";
import type { RuntimeStoreTransaction } from "@use-crux/core/runtime";
import type { RuntimeResultPayloadPort } from "@use-crux/core/runtime";
import { createCloudflareLeasePort } from "./leases";
import { createCloudflareEventPort } from "./events";
import { createCloudflareDeferredPort } from "./deferred";
import { createCloudflareOutboxPort } from "./outbox";
import { createCloudflareResultPort } from "./results";
import { createCloudflareStatePort } from "./state";
import { createCloudflareTimerPort } from "./timers";
import { createCloudflareWaiterPort } from "./waiters";
import { asStoragePort } from "./storage";

export function createCloudflareRuntimeStore(
  storage: DurableObjectStorage,
  options: { readonly results?: RuntimeResultPayloadPort } = {},
): EvalHostStore {
  const portsFor = (
    target: DurableObjectStorage | DurableObjectTransaction,
  ): RuntimeStoreTransaction => {
    const port = asStoragePort(target);
    return {
      state: createCloudflareStatePort(port),
      events: createCloudflareEventPort(port),
      waiters: createCloudflareWaiterPort(port),
      timers: createCloudflareTimerPort(port),
      outbox: createCloudflareOutboxPort(port),
      deferred: createCloudflareDeferredPort(port),
    };
  };
  const ports = portsFor(storage);
  return Object.freeze({
    id: "cloudflare-do",
    ...ports,
    leases: createCloudflareLeasePort(
      async (run) =>
        await storage.transaction((transaction) =>
          run(asStoragePort(transaction)),
        ),
    ),
    results:
      options.results ?? createCloudflareResultPort(asStoragePort(storage)),
    async transact<T>(fn: (tx: RuntimeStoreTransaction) => Promise<T>) {
      return await storage.transaction(async (transaction) =>
        fn(portsFor(transaction)),
      );
    },
  });
}
