import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MemoryStoreDetail } from "@/types";
import { DefinitionBindingCard } from "./MemoryBinding";

describe("DefinitionBindingCard memory capture mode", () => {
  it("renders effective inline and deferred modes with their lifecycle meaning", () => {
    const deferred = renderToStaticMarkup(
      <DefinitionBindingCard store={memoryStore("deferred")} />,
    );
    const inline = renderToStaticMarkup(
      <DefinitionBindingCard store={memoryStore("inline")} />,
    );

    expect(deferred).toContain('data-memory-capture-mode="deferred"');
    expect(deferred).toContain(
      "Retained by the active host when available; otherwise waits inline.",
    );
    expect(inline).toContain('data-memory-capture-mode="inline"');
    expect(inline).toContain(
      "Always completes before the owning operation returns.",
    );
  });
});

function memoryStore(captureMode: "inline" | "deferred"): MemoryStoreDetail {
  return {
    id: `capture-${captureMode}`,
    type: "working",
    scope: { kind: "session", id: "session:1" },
    stats: {
      reads: 0,
      writes: 0,
      entries: 0,
      conflicts: 0,
      lifetime: { startedAt: 0, lastTouchedAt: 0, durationMs: 0 },
    },
    health: "healthy",
    captureMode,
    state: { type: "working", fields: [], mutations: [] },
  };
}
