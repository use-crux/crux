import type {
  ClaimOptions,
  Lease,
  LeasePort,
  LeaseResource,
} from '../../ports/leases'
import type { LeaseToken } from '../../ports/ids'
import type { MemoryRuntimeData } from './data'

export function createMemoryLeasePort(data: MemoryRuntimeData): LeasePort {
  return {
    async claim(
      resource: LeaseResource,
      options: ClaimOptions,
    ): Promise<Lease | null> {
      const existing = data.leases.get(resource)
      const now = Date.now()
      if (existing && existing.expiresAt.getTime() > now) return null

      const lease = makeLease(data, resource, options)
      data.leases.set(resource, lease)
      return cloneLease(lease)
    },

    async extend(lease: Lease, ttlMs: number): Promise<Lease> {
      const existing = data.leases.get(lease.resource)
      if (!existing || existing.token !== lease.token) {
        throw new Error(`Cannot extend a lease not owned by this token.`)
      }
      const extended: Lease = Object.freeze({
        resource: lease.resource,
        token: lease.token,
        expiresAt: new Date(Date.now() + ttlMs),
        ownerId: lease.ownerId,
      })
      data.leases.set(lease.resource, extended)
      return cloneLease(extended)
    },

    async release(lease: Lease): Promise<void> {
      const existing = data.leases.get(lease.resource)
      if (existing?.token === lease.token) {
        data.leases.delete(lease.resource)
      }
    },
  }
}

function makeLease(
  data: MemoryRuntimeData,
  resource: LeaseResource,
  options: ClaimOptions,
): Lease {
  const lease: Lease = Object.freeze({
    resource,
    token: `lease_${data.nextLeaseId}` as LeaseToken,
    expiresAt: new Date(Date.now() + options.ttlMs),
    ownerId: options.ownerId,
  })
  data.nextLeaseId += 1
  return lease
}

function cloneLease(lease: Lease): Lease {
  return Object.freeze({
    resource: lease.resource,
    token: lease.token,
    expiresAt: new Date(lease.expiresAt),
    ownerId: lease.ownerId,
  })
}
