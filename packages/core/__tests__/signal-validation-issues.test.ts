import { describe, expect, it, vi } from "vitest";
import { signal } from "@use-crux/core";
import {
  SignalValidationError,
  type SignalSchema,
} from "@use-crux/core/signal";

describe("Signal validation issue snapshots", () => {
  it("never invokes schema-owned issue collection methods", async () => {
    const issues = [
      { message: "private-message", path: ["retained", 1] },
    ];
    const slice = vi.fn(() => {
      throw new Error("private-slice-detail");
    });
    const map = vi.fn(() => {
      throw new Error("private-map-detail");
    });
    Object.defineProperties(issues, {
      slice: { value: slice },
      map: { value: map },
    });
    const changed = signal({
      id: "validation.issue-methods",
      schema: rejectingSchema(issues),
    });

    const error = await changed.publish({}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalValidationError);
    expect(slice).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
    expect((error as SignalValidationError).issues).toEqual([
      {
        message: "Signal payload did not satisfy the schema.",
        path: ["retained", 1],
      },
    ]);
  });

  it("reads each schema issue path exactly once", async () => {
    let pathReads = 0;
    const issue = Object.defineProperty(
      { message: "private-message" },
      "path",
      {
        enumerable: true,
        get() {
          pathReads += 1;
          if (pathReads > 1) throw new Error("private-second-path-read");
          return ["retained"];
        },
      },
    );
    const changed = signal({
      id: "validation.single-path-read",
      schema: rejectingSchema([issue]),
    });

    const error = await changed.publish({}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalValidationError);
    expect(pathReads).toBe(1);
    expect((error as SignalValidationError).issues[0]?.path).toEqual([
      "retained",
    ]);
  });

  it("publishes only inert JSON-safe validation path keys", async () => {
    const hostileObjectKey = {
      toJSON() {
        throw new Error("private-object-key-detail");
      },
      toString() {
        throw new Error("private-object-key-string");
      },
    };
    const hostileProxyKey = new Proxy(
      {},
      {
        get() {
          throw new Error("private-proxy-key-detail");
        },
        ownKeys() {
          throw new Error("private-proxy-key-keys");
        },
      },
    );
    const path = [
      "retained",
      2,
      { key: "nested" },
      { key: 3 },
      Symbol("private-symbol"),
      { key: Symbol("private-segment-symbol") },
      { key: hostileObjectKey },
      { key: hostileProxyKey },
    ];
    const changed = signal({
      id: "validation.safe-path-keys",
      schema: rejectingSchema([
        { message: "private-message", path: path as never },
      ]),
    });

    const error = await changed.publish({}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalValidationError);
    const publicError = error as SignalValidationError;
    const retainedPath = publicError.issues[0]?.path;
    expect(retainedPath).toHaveLength(4);
    expect(retainedPath).toEqual([
      "retained",
      2,
      { key: "nested" },
      { key: 3 },
    ]);
    expect(Object.hasOwn(publicError, "issues")).toBe(true);
    expect(Object.isFrozen(publicError.issues)).toBe(true);
    expect(Object.isFrozen(publicError.issues[0])).toBe(true);
    expect(Object.isFrozen(retainedPath)).toBe(true);
    expect(Object.isFrozen(retainedPath?.[2] as object)).toBe(true);
    expect(() => JSON.stringify(publicError)).not.toThrow();
    expect(() => String(publicError)).not.toThrow();
    expect(JSON.stringify(publicError)).not.toContain("private-");
  });
});

function rejectingSchema(issues: readonly unknown[]): SignalSchema {
  return {
    "~standard": {
      version: 1,
      vendor: "validation-issues-test",
      validate: () => ({ issues: issues as never }),
    },
  };
}
