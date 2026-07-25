/**
 * The canonical partial projection behind `partialOutputStream` (RFC #173).
 *
 * These pin the properties the contract requires of a partial: it describes only
 * text that was already published, it grows monotonically, and it never invents a
 * value from an unfinished token.
 */

import { describe, expect, it } from "vitest";
import { createCanonicalPartialProjector } from "../../src/adapter/execution/canonical-partials";

/** Feed one fragment at a time and collect every emitted partial. */
function project(fragments: readonly string[]): unknown[] {
  const projector = createCanonicalPartialProjector();
  const values: unknown[] = [];
  for (const fragment of fragments) {
    const next = projector.push(fragment);
    if (next) values.push(next.value);
  }
  return values;
}

/** Feed one CHARACTER at a time — the worst case for an incremental scanner. */
function projectChars(text: string): unknown[] {
  return project([...text]);
}

describe("canonical partial projection", () => {
  it("emits nothing before anything structurally complete is published", () => {
    // An unterminated root string has no honest projection at all.
    expect(project(['"partia'])).toEqual([]);
    expect(project(["  "])).toEqual([]);
    // Opening the root container IS complete: every member of a partial is
    // optional, so `{` already justifies `{}`.
    expect(project(['{"na'])).toEqual([{}]);
  });

  it("grows monotonically as members complete", () => {
    expect(
      project(['{', '"title":"a"', ',', '"count":2', '}']),
    ).toEqual([{}, { title: "a" }, { title: "a", count: 2 }]);
  });

  it("does not project an unfinished number or literal", () => {
    // `12` may still become `123`, and `tru` is not `true`. Both stay invisible
    // until a delimiter closes them.
    expect(project(['{"count":12'])).toEqual([{}]);
    expect(project(['{"count":12', '3}'])).toEqual([{}, { count: 123 }]);
    expect(project(['{"ok":tru'])).toEqual([{}]);
    expect(project(['{"ok":tru', 'e}'])).toEqual([{}, { ok: true }]);
  });

  it("does not project a half-written string", () => {
    expect(project(['{"title":"partia'])).toEqual([{}]);
    expect(project(['{"title":"partia', 'l"}'])).toEqual([
      {},
      { title: "partial" },
    ]);
  });

  it("keeps an object key out of the projection until its value arrives", () => {
    // Projecting at the closed KEY would produce `{"title"}`, which is not JSON.
    expect(project(['{"title"'])).toEqual([{}]);
    expect(project(['{"title"', ':"a"', ','])).toEqual([{}, { title: "a" }]);
  });

  it("closes open containers rather than waiting for the document to end", () => {
    expect(projectChars('{"tags":["a","b"')).toEqual([
      {},
      { tags: [] },
      { tags: ["a"] },
      { tags: ["a", "b"] },
    ]);
  });

  it("projects nested containers as they close", () => {
    expect(projectChars('{"meta":{"id":1}')).toEqual([
      {},
      { meta: {} },
      { meta: { id: 1 } },
    ]);
  });

  it("carries the newest state when one fragment completes several values", () => {
    // A push yields at most ONE partial: the surface publishes the newest
    // release-ready state rather than replaying every intermediate one.
    expect(project(['{"a":1,"b":2}'])).toEqual([{ a: 1, b: 2 }]);
  });

  it("emits at most once per completed value, not once per fragment", () => {
    const projector = createCanonicalPartialProjector();
    projector.push('{"title":"a"');
    expect(projector.push(",")).toEqual({ value: { title: "a" } });
    // No new value completed, so no new partial — the surface does not repeat.
    expect(projector.push(" ")).toBeUndefined();
  });

  it("does not republish a value that several structural events complete", () => {
    // Opening the nested object, closing it, and closing the root all describe
    // `{"a":{}}`. A monotonic surface must show it once, not three times.
    expect(projectChars('{"a":{}}')).toEqual([{}, { a: {} }]);
  });

  it("handles escaped quotes inside a string without closing it early", () => {
    expect(project(['{"title":"a\\"b"', ','])).toEqual([
      {},
      { title: 'a"b' },
    ]);
  });

  it("projects a completed root scalar", () => {
    expect(project(['"done"'])).toEqual(["done"]);
  });

  it("ignores an empty fragment", () => {
    const projector = createCanonicalPartialProjector();
    expect(projector.push("")).toBeUndefined();
  });
});
