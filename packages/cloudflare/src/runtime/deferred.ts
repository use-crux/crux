import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";
import { scopedKey, scopedPrefix } from "./storage";

export function createCloudflareDeferredPort(
  storage: CloudflareStoragePort,
): RuntimeDeferredStorePort {
  return {
    async getScope(scopeId, options) {
      return (
        (await storage.get<RuntimeDeferredScope>(
          scopedKey("deferred-scope", options.namespace, scopeId),
        )) ?? null
      );
    },
    async createScope(scope) {
      const key = scopedKey("deferred-scope", scope.namespace, scope.scopeId);
      const existing = await storage.get<RuntimeDeferredScope>(key);
      if (existing) return existing;
      await storage.put(key, scope);
      return scope;
    },
    async putScope(scope) {
      const key = scopedKey("deferred-scope", scope.namespace, scope.scopeId);
      const existing = await storage.get<RuntimeDeferredScope>(key);
      if (
        existing &&
        scopeTransitionAllowed(existing.finalization, scope.finalization)
      ) {
        await storage.put(key, scope);
      }
    },
    async listScopes(options) {
      const rows = await storage.list<RuntimeDeferredScope>({
        prefix: scopedPrefix("deferred-scope", options.namespace),
      });
      return [...rows.values()]
        .filter(
          (scope) =>
            (!options.state || scope.finalization.state === options.state) &&
            (!options.leaseExpiresBefore ||
              scope.leaseExpiresAt < options.leaseExpiresBefore),
        )
        .slice(0, options.limit);
    },
    async getIntent(intentId, options) {
      return (
        (await storage.get<RuntimeDeferredIntent>(
          scopedKey("deferred-intent", options.namespace, intentId),
        )) ?? null
      );
    },
    async createIntent(intent) {
      const key = scopedKey(
        "deferred-intent",
        intent.namespace,
        intent.intentId,
      );
      const existing = await storage.get<RuntimeDeferredIntent>(key);
      if (existing) return existing;
      await storage.put(key, intent);
      return intent;
    },
    async putIntent(intent) {
      const key = scopedKey(
        "deferred-intent",
        intent.namespace,
        intent.intentId,
      );
      const existing = await storage.get<RuntimeDeferredIntent>(key);
      if (!existing) return;
      if (existing.state !== "staged" && existing.state !== intent.state)
        return;
      await storage.put(key, {
        ...existing,
        state: intent.state,
        updatedAt: intent.updatedAt,
      });
    },
    async listIntents(options) {
      const rows = await storage.list<RuntimeDeferredIntent>({
        prefix: scopedPrefix("deferred-intent", options.namespace),
      });
      return [...rows.values()]
        .filter(
          (intent) =>
            intent.scopeId === options.scopeId &&
            (!options.state || intent.state === options.state),
        )
        .slice(0, options.limit);
    },
  };
}

function scopeTransitionAllowed(
  from: RuntimeDeferredScope["finalization"],
  to: RuntimeDeferredScope["finalization"],
): boolean {
  if (from.state === "open") return true;
  if (to.state === "open") return false;
  return from.state === to.state;
}
