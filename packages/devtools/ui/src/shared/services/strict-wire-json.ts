const utf8 = new TextEncoder();

/** Parse one bounded JSON value without erasing duplicate-key evidence. */
export function parseStrictWireJson(
  text: string,
  maximumBytes: number,
): unknown {
  if (utf8.encode(text).byteLength > maximumBytes) {
    throw new Error("JSON byte limit");
  }
  rejectDuplicateKeys(text);
  return JSON.parse(text) as unknown;
}

function rejectDuplicateKeys(text: string): void {
  let cursor = 0;
  const whitespace = (): void => {
    while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor += 1;
  };
  const stringToken = (): string => {
    const start = cursor;
    if (text[cursor] !== '"') throw new Error("expected JSON string");
    cursor += 1;
    while (cursor < text.length) {
      const character = text[cursor]!;
      cursor += 1;
      if (character === '"') {
        return JSON.parse(text.slice(start, cursor)) as string;
      }
      if (character === "\\") {
        if (cursor >= text.length) throw new Error("invalid JSON escape");
        cursor += text[cursor] === "u" ? 5 : 1;
      } else if (character.charCodeAt(0) < 0x20) {
        throw new Error("invalid JSON string");
      }
    }
    throw new Error("unterminated JSON string");
  };
  const value = (): void => {
    whitespace();
    const character = text[cursor];
    if (character === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      if (text[cursor] === "}") {
        cursor += 1;
        return;
      }
      for (;;) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) throw new Error("duplicate JSON key");
        keys.add(key);
        whitespace();
        if (text[cursor] !== ":") throw new Error("missing JSON colon");
        cursor += 1;
        value();
        whitespace();
        if (text[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") throw new Error("missing JSON comma");
        cursor += 1;
      }
    }
    if (character === "[") {
      cursor += 1;
      whitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return;
      }
      for (;;) {
        value();
        whitespace();
        if (text[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") throw new Error("missing JSON comma");
        cursor += 1;
      }
    }
    if (character === '"') {
      stringToken();
      return;
    }
    const start = cursor;
    while (cursor < text.length && !/[\s,\]}]/u.test(text[cursor]!)) {
      cursor += 1;
    }
    if (cursor === start) throw new Error("missing JSON value");
  };
  whitespace();
  value();
  whitespace();
  if (cursor !== text.length) throw new Error("trailing JSON");
}
