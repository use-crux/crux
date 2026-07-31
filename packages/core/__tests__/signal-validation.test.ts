import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signal } from "@use-crux/core";
import {
  SignalError,
  SignalValidationError,
  type SignalSchema,
} from "@use-crux/core/signal";
import { CruxRuntimeError } from "@use-crux/core/runtime";

afterEach(() => vi.restoreAllMocks());

describe("Signal payload validation", () => {
  it("rejects schema-invalid payloads before allocating an occurrence", async () => {
    const quantityChanged = signal({
      id: "quantity.changed",
      schema: z.object({ quantity: z.number().int().positive() }),
    });
    const listener = vi.fn();
    quantityChanged.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    await expect(quantityChanged.publish({ quantity: -1 })).rejects.toBeInstanceOf(
      SignalValidationError,
    );

    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps schema issue diagnostics free of rejected payload values", async () => {
    const privateValue = "private-customer-payload";
    const rejectingSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "privacy-test",
        validate: () => ({
          issues: [
            {
              message: `Rejected value: ${privateValue}`,
              path: ["customerToken"],
            },
          ],
        }),
      },
    };
    const rejected = signal({
      id: "private.rejected",
      schema: rejectingSchema,
    });

    const error = await rejected.publish(privateValue).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalValidationError);
    expect(JSON.stringify(error)).not.toContain(privateValue);
  });

  it("rejects JSON-unsafe normalized output before acceptance", async () => {
    const privateField = "privateCustomerField";
    const unsafeSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "unsafe-test",
        validate: () => ({ value: { [privateField]: new Date() } as never }),
      },
    };
    const unsafeSignal = signal({
      id: "unsafe.normalized",
      schema: unsafeSchema,
    });
    const listener = vi.fn();
    unsafeSignal.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const publication = unsafeSignal.publish({});
    await expect(publication).rejects.toMatchObject({
      code: "PAYLOAD_NOT_JSON",
    });
    await expect(publication).rejects.toBeInstanceOf(CruxRuntimeError);
    await expect(publication).rejects.not.toThrow(privateField);
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("replaces poisoned normalized-output failures with a safe JSON error", async () => {
    const privateDetail = "private-poisoned-getter-detail";
    const poisonedOutput = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        throw new Error(privateDetail);
      },
    });
    const poisonedSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "poisoned-output-test",
        validate: () => ({ value: poisonedOutput as never }),
      },
    };
    const poisoned = signal({
      id: "poisoned.normalized",
      schema: poisonedSchema,
    });
    const listener = vi.fn();
    poisoned.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const error = await poisoned.publish({}).catch((cause: unknown) => cause);
    await Promise.resolve();

    expect(error).toBeInstanceOf(CruxRuntimeError);
    expect(error).toMatchObject({ code: "PAYLOAD_NOT_JSON", cause: undefined });
    expect(String(error)).not.toContain(privateDetail);
    expect(JSON.stringify(error)).not.toContain(privateDetail);
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads normalized properties once while validating and detaching", async () => {
    let propertyReads = 0;
    const statefulOutput = Object.defineProperty({}, "status", {
      enumerable: true,
      get() {
        propertyReads += 1;
        return propertyReads === 1 ? "first-value" : "private-second-value";
      },
    });
    const statefulSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "stateful-output-test",
        validate: () => ({ value: statefulOutput as never }),
      },
    };
    const stateful = signal({ id: "stateful.normalized", schema: statefulSchema });
    const delivered = Promise.withResolvers<unknown>();
    stateful.subscribe((occurrence) => delivered.resolve(occurrence.payload));

    await stateful.publish({});

    await expect(delivered.promise).resolves.toEqual({ status: "first-value" });
    expect(propertyReads).toBe(1);
  });

  it("wraps schema execution failures without exposing private details", async () => {
    const privateDetail = "private-schema-provider-detail";
    const failingSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "failing-test",
        validate: () => {
          throw new Error(privateDetail);
        },
      },
    };
    const rejected = signal({ id: "schema.rejected", schema: failingSchema });
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const error = await rejected.publish({}).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code: "publication_rejected" });
    expect(String(error)).not.toContain(privateDetail);
    expect(randomUuid).not.toHaveBeenCalled();
  });

  it.each([
    [
      "result issues",
      () =>
        new Proxy(
          { value: null },
          {
            get(target, property, receiver) {
              if (property === "issues") {
                throw new Error("private-result-detail");
              }
              return Reflect.get(target, property, receiver);
            },
          },
        ),
    ],
    [
      "result value",
      () =>
        new Proxy(
          { value: null, issues: undefined },
          {
            get(target, property, receiver) {
              if (property === "value") {
                throw new Error("private-result-value-detail");
              }
              return Reflect.get(target, property, receiver);
            },
          },
        ),
    ],
    [
      "issues",
      () => ({
        issues: new Proxy([{ message: "private-issue-message" }], {
          get() {
            throw new Error("private-issues-detail");
          },
        }),
      }),
    ],
    [
      "issue",
      () => ({
        issues: [
          new Proxy(
            { message: "private-issue-message" },
            {
              get() {
                throw new Error("private-issue-detail");
              },
            },
          ),
        ],
      }),
    ],
    [
      "path",
      () => ({
        issues: [
          {
            message: "private-issue-message",
            path: new Proxy(["private-path-value"], {
              get() {
                throw new Error("private-path-detail");
              },
            }),
          },
        ],
      }),
    ],
  ])(
    "safely rejects hostile Standard Schema %s access before acceptance",
    async (boundary, result) => {
      const hostileSchema: SignalSchema = {
        "~standard": {
          version: 1,
          vendor: `hostile-${boundary}-test`,
          validate: () => result() as never,
        },
      };
      const hostile = signal({ id: `hostile.${boundary}`, schema: hostileSchema });
      const listener = vi.fn();
      hostile.subscribe(listener);
      const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

      const error = await hostile.publish({}).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(SignalError);
      expect(error).toMatchObject({ code: "publication_rejected" });
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain("private-");
      expect(JSON.stringify(error)).not.toContain("private-");
      expect(randomUuid).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    },
  );
});
