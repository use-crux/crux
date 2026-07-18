import type {
  DurableEventPort,
  EventCursor,
  RuntimeEvent,
} from "@use-crux/core/runtime";
import type { CloudflareStoragePort } from "./storage";
import { scopedKey, scopedPrefix } from "./storage";

const NEXT_EVENT_ID = "counter:event";

export function createCloudflareEventPort(
  storage: CloudflareStoragePort,
): DurableEventPort {
  return {
    async append(input, options = {}) {
      const duplicateKey = options.idempotencyKey
        ? scopedKey(
            "event-idempotency",
            input.namespace,
            options.idempotencyKey,
          )
        : input.eventId
          ? scopedKey("event-identity", input.namespace, input.eventId)
          : undefined;
      if (duplicateKey) {
        const existingId = await storage.get<string>(duplicateKey);
        if (existingId) {
          const existing = await eventById(
            storage,
            input.namespace,
            existingId,
          );
          if (existing) return existing;
        }
      }
      const next = ((await storage.get<number>(NEXT_EVENT_ID)) ?? 0) + 1;
      await storage.put(NEXT_EVENT_ID, next);
      const eventId = (input.eventId ??
        `event_${String(next).padStart(16, "0")}`) as EventCursor;
      const event: RuntimeEvent = {
        ...input,
        eventId,
        appendedAt: new Date(),
      };
      await storage.put(eventKey(input.namespace, eventId), event);
      if (duplicateKey) await storage.put(duplicateKey, eventId);
      return event;
    },
    async read(options) {
      const rows = await storage.list<RuntimeEvent>({
        prefix: scopedPrefix("event", options.namespace),
      });
      const ordered = [...rows.values()].sort(
        (left, right) =>
          left.appendedAt.getTime() - right.appendedAt.getTime() ||
          left.eventId.localeCompare(right.eventId),
      );
      const start = options.after
        ? Math.max(
            0,
            ordered.findIndex((event) => event.eventId === options.after) + 1,
          )
        : 0;
      const events = ordered.slice(
        start,
        start + (options.limit ?? ordered.length),
      );
      return {
        events,
        ...(events.length > 0 ? { cursor: events.at(-1)!.eventId } : {}),
      };
    },
    async prune(options) {
      const rows = await storage.list<RuntimeEvent>({ prefix: "event:" });
      const eligible = [...rows.entries()].filter(
        ([, event]) =>
          (!options.namespace || event.namespace === options.namespace) &&
          event.appendedAt < options.before,
      );
      const selected = eligible.slice(0, options.limit);
      if (selected.length > 0)
        await storage.delete(selected.map(([key]) => key));
      return {
        removed: selected.length,
        truncated: eligible.length > selected.length,
      };
    },
  };
}

function eventKey(namespace: string, eventId: string): string {
  return scopedKey("event", namespace, eventId);
}

async function eventById(
  storage: CloudflareStoragePort,
  namespace: string,
  eventId: string,
): Promise<RuntimeEvent | undefined> {
  return await storage.get<RuntimeEvent>(eventKey(namespace, eventId));
}
