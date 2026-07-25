import { describe, expect, it } from "vitest";
import { md, type PromptText } from "../src/prompt-text";
import { isPromptText, lowerPromptText } from "../src/prompt-text/internal";
import {
  promptTextConstructionErrorFixtures,
  promptTextGoldenFixtures,
} from "./fixtures/prompt-text-golden";

describe("PromptText", () => {
  it("is an opaque frozen null-prototype value", () => {
    const value = md`
hello
    `;
    const forged = Object.freeze(Object.create(null)) as unknown;

    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.ownKeys(value)).toEqual([]);
    expect(JSON.stringify(value)).toBe("{}");
    expect(() => String(value)).toThrow(TypeError);
    expect(isPromptText(value)).toBe(true);
    expect(isPromptText(forged)).toBe(false);
  });

  it("lowers one-line authored text with static provenance", () => {
    expect(
      lowerPromptText(md`
hello
      `),
    ).toEqual({
      text: "hello",
      segments: [{ text: "hello", dynamic: false }],
    });
  });

  it("removes outer blank lines and common indentation", () => {
    const fixture = promptTextGoldenFixtures.find(
      ({ name }) => name === "removes outer blank lines and common spaces",
    )!;

    expect(lowerPromptText(fixture.create()).text).toBe(fixture.text);
  });

  it("snapshots scalar values and nullish or false omissions", () => {
    const text = md`${"value"}:${42}:${-0}:${false}:${null}:${undefined}`;

    expect(lowerPromptText(text)).toEqual({
      text: "value:42:0:::",
      segments: [
        { text: "value", dynamic: true },
        { text: ":", dynamic: false },
        { text: "42", dynamic: true },
        { text: ":", dynamic: false },
        { text: "0", dynamic: true },
        { text: ":::", dynamic: false },
      ],
    });
  });

  it("normalizes nested fragments before applying parent indentation", () => {
    const fixture = promptTextGoldenFixtures.find(
      ({ name }) =>
        name === "normalizes a nested fragment before parent indentation",
    )!;

    expect(lowerPromptText(fixture.create())).toEqual({
      text: fixture.text,
      segments: fixture.segments,
    });
  });

  it("renders nested sequences with one dynamic separator per item", () => {
    const fixture = promptTextGoldenFixtures.find(
      ({ name }) => name === "assigns sequence separators to dynamic ownership",
    )!;

    expect(lowerPromptText(fixture.create())).toEqual({
      text: fixture.text,
      segments: fixture.segments,
    });
  });

  it("removes empty block carriers with the local earliest-longest seam rule", () => {
    const seamFixtures = promptTextGoldenFixtures.filter(({ name }) =>
      [
        "removes an empty carrier at the beginning",
        "removes an empty carrier in the middle without adding a blank",
        "removes an empty carrier at the end",
        "keeps the larger blank run around an empty carrier",
        "keeps preceding whitespace bytes when seam runs tie",
        "keeps the earliest longest run across adjacent omissions",
        "does not collapse unrelated intentional blank runs",
      ].includes(name),
    );

    for (const fixture of seamFixtures) {
      expect(lowerPromptText(fixture.create()).text, fixture.name).toBe(
        fixture.text,
      );
    }

    expect(
      lowerPromptText(md`
        before
        ${undefined}
        ${undefined}
        after
      `).text,
    ).toBe("before\nafter");
  });

  it("matches every renderer golden fixture byte-for-byte", () => {
    for (const fixture of promptTextGoldenFixtures) {
      const rendered = lowerPromptText(fixture.create());
      expect(rendered.text, fixture.name).toBe(fixture.text);
      expect(
        rendered.segments.map((segment) => segment.text).join(""),
        `${fixture.name} segment reconstruction`,
      ).toBe(rendered.text);
      if (fixture.segments) {
        expect(rendered.segments, `${fixture.name} segments`).toEqual(
          fixture.segments,
        );
      }
    }
  });

  it("recursively snapshots arrays, permits shared branches, and rejects cycles", () => {
    const shared = ["one"];
    const source = [shared, shared];
    const value = md`\n${source}\n`;

    shared[0] = "changed";
    source.push(["later"]);

    expect(lowerPromptText(value).text).toBe("one\none");

    const cyclic: unknown[] = [];
    cyclic.push(["safe", cyclic]);
    expectPromptTextError(
      () => md`\n${cyclic as never}\n`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "interpolation 0[0][1]",
      "cyclic array",
    );
  });

  it("rejects every inline sequence during construction", () => {
    for (const fixture of promptTextConstructionErrorFixtures) {
      expectPromptTextError(
        fixture.create,
        fixture.code,
        "interpolation 0",
        "move the sequence to a line by itself or join scalar values with native `.join()`",
      );
    }
  });

  it("rejects unsupported values with safe kinds and exact nested paths", () => {
    const invalidValues: readonly [unknown, string][] = [
      [true, "boolean"],
      [NaN, "non-finite number"],
      [Infinity, "non-finite number"],
      [1n, "bigint"],
      [Symbol("secret"), "symbol"],
      [() => "secret", "function"],
      [Promise.resolve("secret"), "object"],
      [Object.create(null), "object"],
    ];

    for (const [value, kind] of invalidValues) {
      expectPromptTextError(
        () => md`${value as never}`,
        "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
        "interpolation 0",
        kind,
        "select a scalar field, return a fragment, or use md.json() for intentional JSON",
      );
    }

    const secret = "SENTINEL_PROMPT_TEXT_SECRET";
    const value = {
      secretKey: secret,
      get toString() {
        throw new Error(secret);
      },
    };
    const error = captureError(() => md`\n${["safe", [value]] as never}\n`);
    expect(error).toMatchObject({
      name: "PromptTextError",
      code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      interpolationIndex: 0,
      interpolationPath: [1, 0],
    });
    expect(error.message).toContain("interpolation 0[1][0]");
    expect(error.message).toContain("object");
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("secretKey");
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("classifies thenables and hostile or revoked proxies without observation", () => {
    const secret = "SENTINEL_PROXY_TRAP";
    let trapCount = 0;
    const failTrap = (): never => {
      trapCount += 1;
      throw new Error(secret);
    };
    const thenable = {
      get then(): never {
        return failTrap();
      },
    };
    const objectProxy = createHostileProxy({}, failTrap);
    const callableProxy = createHostileProxy(() => undefined, failTrap);

    expectPromptTextError(
      () => md`${thenable as never}`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "Invalid object",
    );
    expectPromptTextError(
      () => md`${objectProxy as never}`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "Invalid object",
    );
    expectPromptTextError(
      () => md`${callableProxy as never}`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "Invalid function",
    );
    expect(trapCount).toBe(0);

    const revokedObject = Proxy.revocable({}, {});
    const revokedCallable = Proxy.revocable(() => undefined, {});
    revokedObject.revoke();
    revokedCallable.revoke();

    const revokedObjectError = expectPromptTextError(
      () => md`${revokedObject.proxy as never}`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "Invalid object",
    );
    const revokedCallableError = expectPromptTextError(
      () => md`${revokedCallable.proxy as never}`,
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "Invalid function",
    );
    for (const error of [revokedObjectError, revokedCallableError]) {
      expect(error.message).not.toContain("revoked");
      expect(error.message).not.toContain("IsArray");
    }
  });

  it("snapshots native JSON output and reports safe serialization failures", () => {
    const source = {
      value: "first",
      omitted: undefined,
      array: [undefined],
    };
    const value = md.json(source);
    source.value = "changed";

    expect(lowerPromptText(value)).toEqual({
      text: '{\n  "value": "first",\n  "array": [\n    null\n  ]\n}',
      segments: [
        {
          text: '{\n  "value": "first",\n  "array": [\n    null\n  ]\n}',
          dynamic: true,
        },
      ],
    });

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const invalid of [undefined, 1n, cyclic]) {
      expectPromptTextError(
        () => md.json(invalid),
        "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
        "remove cycles/bigint or serialize explicitly before interpolation",
      );
    }

    const secret = "SENTINEL_JSON_SECRET";
    const error = captureError(() =>
      md.json({
        get value() {
          throw new Error(secret);
        },
      }),
    );
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});

function expectPromptTextError(
  create: () => PromptText,
  code: string,
  ...messageParts: readonly string[]
): Error {
  const error = captureError(create);
  expect(error).toMatchObject({ name: "PromptTextError", code });
  expect(error.message.startsWith(code)).toBe(true);
  for (const part of messageParts) {
    expect(error.message).toContain(part);
  }
  return error;
}

function captureError(create: () => PromptText): Error {
  try {
    create();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected PromptText construction to fail");
}

function createHostileProxy<T extends object>(
  target: T,
  failTrap: () => never,
): T {
  return new Proxy(target, {
    apply: failTrap,
    construct: failTrap,
    defineProperty: failTrap,
    deleteProperty: failTrap,
    get: failTrap,
    getOwnPropertyDescriptor: failTrap,
    getPrototypeOf: failTrap,
    has: failTrap,
    isExtensible: failTrap,
    ownKeys: failTrap,
    preventExtensions: failTrap,
    set: failTrap,
    setPrototypeOf: failTrap,
  });
}
