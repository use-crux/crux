import { afterEach, describe, expect, it } from "vitest";
import { prompt, resetHooks, session } from "@use-crux/core";
import { agent } from "@use-crux/core/agent";
import { z } from "zod";
import { sessionHost, sessionTestModel } from "./public-session.test-support";

afterEach(() => resetHooks());

describe("public Agent Session input acceptance", () => {
  it("requires a Prompt input schema before accepting durably", async () => {
    const support = agent({
      id: "schema-session-support",
      model: sessionTestModel,
      prompt: prompt({ system: "Reply helpfully." }),
    });
    const { host, store } = sessionHost("schema-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "schema" }));

    await expect(handle.send({})).rejects.toMatchObject({
      code: "SESSION_INPUT_INVALID",
    });
    expect(
      store.testing.sessionRecord("schema-session-test", handle.id),
    ).toMatchObject({
      acceptedCursor: 0,
      wakePending: false,
    });
    host.dispose();
  });

  it("returns a frozen empty batch without cursor or wake advancement", async () => {
    const support = agent({
      id: "empty-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("empty-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "empty" }));

    const accepted = await handle.sendMany([]);
    expect(accepted).toEqual([]);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(
      store.testing.sessionRecord("empty-session-test", handle.id),
    ).toMatchObject({
      acceptedCursor: 0,
      wakePending: false,
    });
    host.dispose();
  });

  it("stores the Prompt schema's parsed value", async () => {
    const support = agent({
      id: "parsed-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({
          message: z.string().transform((value) => value.trim()),
        }),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("parsed-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "parsed" }));

    await handle.send({ message: "  Hello  " });
    expect(
      store.testing.sessionInputs("parsed-session-test", handle.id),
    ).toEqual([expect.objectContaining({ input: { message: "Hello" } })]);
    host.dispose();
  });

  it("rejects JSON-unsafe parsed input without consuming a cursor", async () => {
    const support = agent({
      id: "json-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({ value: z.any() }),
        system: "Reply helpfully.",
      }),
    });
    const { host } = sessionHost("json-session-test", { targets: [support] });
    const handle = await host.run(() => session(support, { key: "json" }));

    await expect(handle.send({ value: new Date() })).rejects.toMatchObject({
      code: "SESSION_INPUT_INVALID",
    });
    await expect(handle.send({ value: "safe" })).resolves.toMatchObject({
      cursor: "1",
    });
    host.dispose();
  });

  it("rejects bounded JSON input without consuming a cursor", async () => {
    const support = agent({
      id: "bounded-json-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({ value: z.any() }),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("bounded-json-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "bounded" }));
    let tooDeep: unknown = "leaf";
    for (let index = 0; index < 65; index += 1) tooDeep = [tooDeep];

    await expect(handle.send({ value: tooDeep })).rejects.toMatchObject({
      code: "SESSION_INPUT_INVALID",
    });
    await expect(
      handle.send({ value: Array.from({ length: 100_001 }, () => 0) }),
    ).rejects.toMatchObject({ code: "SESSION_INPUT_INVALID" });
    expect(
      store.testing.sessionRecord("bounded-json-session-test", handle.id),
    ).toMatchObject({ acceptedCursor: 0, wakePending: false });
    await expect(handle.send({ value: "safe" })).resolves.toMatchObject({
      cursor: "1",
    });
    host.dispose();
  });

  it("round-trips an own __proto__ input key as frozen data", async () => {
    const support = agent({
      id: "proto-json-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.any(),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("proto-json-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "proto" }));
    const input = JSON.parse('{"__proto__":{"safe":true}}');

    await handle.send(input);
    const stored = store.testing.sessionInputs(
      "proto-json-session-test",
      handle.id,
    )[0]?.input as Record<string, unknown>;
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.hasOwn(stored, "__proto__")).toBe(true);
    expect(stored.__proto__).toEqual({ safe: true });
    expect(Object.isFrozen(stored)).toBe(true);
    host.dispose();
  });

  it("validates sendMany atomically and serializes concurrent sends", async () => {
    const support = agent({
      id: "atomic-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("atomic-session-test", {
      targets: [support],
    });
    const handle = await host.run(() => session(support, { key: "atomic" }));

    await expect(
      handle.sendMany([{ message: "valid" }, { message: 42 } as never]),
    ).rejects.toMatchObject({ code: "SESSION_INPUT_INVALID" });
    expect(
      store.testing.sessionInputs("atomic-session-test", handle.id),
    ).toEqual([]);

    const batch = await handle.sendMany([
      { message: "first" },
      { message: "second" },
    ]);
    expect(batch.map(({ cursor }) => cursor)).toEqual(["1", "2"]);
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        handle.send({ message: `concurrent:${index}` }),
      ),
    );
    expect(new Set(concurrent.map(({ cursor }) => cursor)).size).toBe(12);
    expect(
      concurrent.map(({ cursor }) => Number(cursor)).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 3));
    host.dispose();
  });

  it("bounds payload-safe input inspection to 64 identities", async () => {
    const support = agent({
      id: "inspection-session-support",
      model: sessionTestModel,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        system: "Reply helpfully.",
      }),
    });
    const { host } = sessionHost("inspection-session-test", {
      targets: [support],
    });
    const handle = await host.run(() =>
      session(support, { key: "inspection" }),
    );

    await handle.sendMany(
      Array.from({ length: 70 }, (_, index) => ({
        message: `private:${index}`,
      })),
    );
    const inspection = await handle.inspect();

    expect(inspection.inputs).toHaveLength(64);
    expect(inspection.inputs[0]).toMatchObject({
      cursor: "7",
      state: "accepted",
    });
    expect(inspection.inputs.at(-1)).toMatchObject({
      cursor: "70",
      state: "accepted",
    });
    expect(inspection.coverage).toEqual({ inputs: "truncated", limit: 64 });
    expect(JSON.stringify(inspection)).not.toContain("private:");
    host.dispose();
  });
});
