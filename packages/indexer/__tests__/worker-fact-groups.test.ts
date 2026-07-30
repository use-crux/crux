import { describe, expect, it } from "vitest";
import type { IndexPatch } from "../src/indexer/patches";
import {
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEvents,
} from "../src/contracts/worker-events";
import { readStaticIndexRuntimeSharedFixture } from "../src/contracts/fixtures";

describe("project index worker fact-group presence", () => {
  it("preserves an explicit empty diagnostic replacement", () => {
    const patch = semanticPatch({ diagnostics: [] });

    const events = indexPatchToWorkerEvents(patch, workerOptions());

    expect(indexPatchFromWorkerEvents(events)).toEqual(patch);
  });

  it("declares every fact group in canonical order", () => {
    const patch = semanticPatch({
      prompts: [],
      contexts: [],
      tools: [],
      lint: { profile: "recommended" },
      definitions: [],
      relations: [],
      sourceRefs: [],
      diagnostics: [],
      lintFindings: [],
      ruleDescriptors: [],
      sources: [],
      sourceGraph: {
        schemaVersion: 1,
        producedBy: "@use-crux/indexer",
        capabilities: [],
      },
    });

    const events = indexPatchToWorkerEvents(patch, workerOptions());
    const done = events.find((event) => event.type === "phase:done");

    expect(done?.summary.factGroups).toEqual([
      "prompts",
      "contexts",
      "tools",
      "lint",
      "definitions",
      "relations",
      "sourceRefs",
      "diagnostics",
      "lintFindings",
      "ruleDescriptors",
      "sources",
      "sourceGraph",
    ]);
    expect(done?.summary.factCount).toBe(2);
    expect(indexPatchFromWorkerEvents(events)).toEqual(patch);
  });

  it("keeps a legacy omission distinct from an explicit empty declaration", () => {
    const events = indexPatchToWorkerEvents(semanticPatch({}), workerOptions());
    const done = events.find((event) => event.type === "phase:done");
    expect(done?.summary.factGroups).toEqual([]);

    const legacyEvents = events.map((event) =>
      event.type === "phase:done"
        ? {
            ...event,
            summary: { factCount: event.summary.factCount },
          }
        : event,
    );

    expect(indexPatchFromWorkerEvents(legacyEvents).facts).toEqual({});
  });

  it.each([
    ["null", null],
    ["object", {}],
    ["null element", [null]],
    ["unknown group", ["unknown"]],
    ["duplicate group", ["diagnostics", "diagnostics"]],
    ["out-of-order groups", ["sources", "diagnostics"]],
  ])("rejects %s factGroups", (_name, factGroups) => {
    const events = JSON.parse(
      JSON.stringify(
        indexPatchToWorkerEvents(semanticPatch({}), workerOptions()),
      ),
    );
    const done = events.find(
      (event: { type?: unknown }) => event.type === "phase:done",
    );
    done.summary.factGroups = factGroups;

    expect(() => indexPatchFromWorkerEvents(events)).toThrow();
  });

  it("rejects a factCount that differs from emitted envelopes", () => {
    const events = JSON.parse(
      JSON.stringify(
        indexPatchToWorkerEvents(
          semanticPatch({ diagnostics: [] }),
          workerOptions(),
        ),
      ),
    );
    const done = events.find(
      (event: { type?: unknown }) => event.type === "phase:done",
    );
    done.summary.factCount = 1;

    expect(() => indexPatchFromWorkerEvents(events)).toThrow(/factCount/);
  });

  it("rejects undeclared envelopes", () => {
    const events = JSON.parse(
      JSON.stringify(
        indexPatchToWorkerEvents(
          semanticPatch({
            diagnostics: [
              {
                id: "diagnostic:one",
                severity: "error",
                code: "test",
                message: "test",
              },
            ],
          }),
          workerOptions(),
        ),
      ),
    );
    const done = events.find(
      (event: { type?: unknown }) => event.type === "phase:done",
    );
    done.summary.factGroups = [];

    expect(() => indexPatchFromWorkerEvents(events)).toThrow(/undeclared/);
  });

  it("requires exactly one envelope for a declared singleton group", () => {
    const events = JSON.parse(
      JSON.stringify(
        indexPatchToWorkerEvents(
          semanticPatch({ lint: { profile: "recommended" } }),
          workerOptions(),
        ),
      ),
    );
    const withoutFacts = events.filter(
      (event: { type?: unknown }) => event.type !== "fact:batch",
    );
    const done = withoutFacts.find(
      (event: { type?: unknown }) => event.type === "phase:done",
    );
    done.summary.factCount = 0;

    expect(() => indexPatchFromWorkerEvents(withoutFacts)).toThrow(
      /exactly one/,
    );
  });

  it("rejects duplicate envelopes for a declared singleton group", () => {
    const events = JSON.parse(
      JSON.stringify(
        indexPatchToWorkerEvents(
          semanticPatch({ lint: { profile: "recommended" } }),
          workerOptions(),
        ),
      ),
    );
    const batch = events.find(
      (event: { type?: unknown }) => event.type === "fact:batch",
    );
    batch.facts.push({ ...batch.facts[0], factId: "lint:duplicate" });
    const done = events.find(
      (event: { type?: unknown }) => event.type === "phase:done",
    );
    done.summary.factCount = 2;

    expect(() => indexPatchFromWorkerEvents(events)).toThrow(/exactly one/);
  });

  it("rejects a null producer fact group before emitting a transaction", () => {
    expect(() =>
      indexPatchToWorkerEvents(
        semanticPatch({ diagnostics: null } as never),
        workerOptions(),
      ),
    ).toThrow(/cannot be null/);
  });

  it("decodes both new and legacy shared V3 goldens", () => {
    const fixture = readStaticIndexRuntimeSharedFixture("worker-events");
    const done = fixture.events.find((event) => event.type === "phase:done");

    expect(done?.summary.factGroups).toEqual(["definitions", "diagnostics"]);
    expect(
      indexPatchFromWorkerEvents(fixture.events).facts.diagnostics,
    ).toHaveLength(1);
    expect(indexPatchFromWorkerEvents(fixture.legacyEvents).facts).toEqual({});
  });
});

function semanticPatch(facts: IndexPatch["facts"]): IndexPatch {
  return {
    schemaVersion: 1,
    phase: "semantic",
    project: { root: "/repo", name: "prompt-text-clear" },
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:00.001Z",
    status: "ok",
    semanticBackend: "typescript",
    facts,
  };
}

function workerOptions() {
  return {
    transactionId: "tx-prompt-text-clear",
    producer: { name: "@use-crux/indexer", version: "test" },
  } as const;
}
