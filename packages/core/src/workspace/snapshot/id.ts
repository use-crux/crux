/** Private opaque snapshot identifier generation. */

let fallbackId = 0;

export function createSnapshotId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `${Date.now().toString(36)}-${fallbackId.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
