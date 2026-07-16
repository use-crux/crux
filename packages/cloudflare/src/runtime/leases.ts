import type {
  ClaimOptions,
  Lease,
  LeasePort,
  LeaseResource,
  LeaseToken,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";

export function createCloudflareLeasePort(
  transact: <T>(
    run: (storage: CloudflareStoragePort) => Promise<T>,
  ) => Promise<T>,
): LeasePort {
  return {
    async claim(resource: LeaseResource, options: ClaimOptions) {
      return await transact(async (transaction) => {
        const key = `lease:${encodeURIComponent(resource)}`;
        const existing = await transaction.get<Lease>(key);
        if (existing && existing.expiresAt.getTime() > Date.now()) return null;
        const lease: Lease = {
          resource,
          token: crypto.randomUUID() as LeaseToken,
          expiresAt: new Date(Date.now() + options.ttlMs),
          ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        };
        await transaction.put(key, lease);
        return lease;
      });
    },
    async extend(lease, ttlMs) {
      return await transact(async (transaction) => {
        const key = `lease:${encodeURIComponent(lease.resource)}`;
        const existing = await transaction.get<Lease>(key);
        if (!existing || existing.token !== lease.token) {
          throw new Error("Cannot extend a lease not owned by this token.");
        }
        const extended = { ...lease, expiresAt: new Date(Date.now() + ttlMs) };
        await transaction.put(key, extended);
        return extended;
      });
    },
    async release(lease) {
      await transact(async (transaction) => {
        const key = `lease:${encodeURIComponent(lease.resource)}`;
        const existing = await transaction.get<Lease>(key);
        if (existing?.token === lease.token) await transaction.delete(key);
      });
    },
  };
}
