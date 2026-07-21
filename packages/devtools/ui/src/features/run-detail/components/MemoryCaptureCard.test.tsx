import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  MemoryCaptureDisposition,
  MemoryCaptureView,
} from "../lib/memory-capture";
import { MemoryCaptureCard } from "./MemoryCaptureCard";

function view(
  disposition: MemoryCaptureDisposition,
  fields: Partial<MemoryCaptureView> = {},
): MemoryCaptureView {
  return {
    memoryId: "conversation",
    operation: "turn",
    requestedMode: disposition === "inline" ? "inline" : "deferred",
    disposition,
    sequence: 7,
    blockCount: 2,
    toolEventCount: 1,
    outcome: disposition === "eval-captured" ? "captured" : "completed",
    durationMs: 30,
    status: "ok",
    memory: {
      label: "memory",
      value: "memory:conversation",
      kind: "memory",
      role: "invoked-memory",
      resolved: true,
      to: { view: "library-index", promptId: "memory:conversation" },
    },
    ...fields,
  };
}

describe("MemoryCaptureCard", () => {
  it.each([
    "inline",
    "inline-fallback",
    "retained",
    "eval-captured",
  ] as const)("renders the %s disposition", (disposition) => {
    const html = renderToStaticMarkup(
      <MemoryCaptureCard view={view(disposition)} />,
    );

    expect(html).toContain(disposition);
    expect(html).toContain("conversation");
    expect(html).toContain("turn");
    expect(html).toContain("30ms");
  });

  it("explains inline fallback and Eval capture exactly", () => {
    const fallback = renderToStaticMarkup(
      <MemoryCaptureCard view={view("inline-fallback")} />,
    );
    const captured = renderToStaticMarkup(
      <MemoryCaptureCard view={view("eval-captured")} />,
    );

    expect(fallback).toContain(
      "No retained host accepted this work; capture ran inline.",
    );
    expect(captured).toContain(
      "Eval recorded deferred intent; memory hooks did not run.",
    );
  });

  it("explains retained work beyond the response boundary", () => {
    const html = renderToStaticMarkup(
      <MemoryCaptureCard view={view("retained")} />,
    );

    expect(html).toContain("retained work beyond the response boundary");
  });

  it("renders the exact Catalog target when it resolves", () => {
    const onOpenCatalog = vi.fn();
    const html = renderToStaticMarkup(
      <MemoryCaptureCard
        view={view("retained")}
        onOpenCatalog={onOpenCatalog}
      />,
    );

    expect(html).toContain("Catalog");
    expect(html).toContain("memory:conversation");
  });

  it("shows safe failure evidence without reading raw error text", () => {
    const rawSentinel = "PRIVATE_CAPTURE_FAILURE_SENTINEL";
    const failedView = {
      ...view("retained", {
        outcome: "failed",
        status: "error",
        code: "CAPTURE_FAILED",
      }),
      error: rawSentinel,
    };
    const html = renderToStaticMarkup(
      <MemoryCaptureCard view={failedView} />,
    );

    expect(html).toContain("failed");
    expect(html).toContain("CAPTURE_FAILED");
    expect(html).not.toContain(rawSentinel);
  });
});
