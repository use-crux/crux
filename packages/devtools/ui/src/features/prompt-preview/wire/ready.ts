import {
  exactWireKeys,
  finiteNumber,
  nonnegativeSafeInteger,
  wireObject,
  wireString,
  type WireObject,
} from "./common";

const MAX_SEGMENTS = 10_000;
const MAX_ITEMS = 1_024;

interface Bounds {
  segments: number;
}

/** Validate the complete bounded inspection payload of one ready response. */
export function decodeReadyInspection(value: WireObject): void {
  const bounds: Bounds = { segments: 0 };
  exactWireKeys(
    value,
    ["system", "totalTokens", "droppedContexts", "excludedContexts"],
    ["prompt", "tokenBudget", "tools"],
  );
  nonnegativeSafeInteger(value.totalTokens);
  if (value.tokenBudget !== undefined) {
    nonnegativeSafeInteger(value.tokenBudget);
  }
  decodeSystem(wireObject(value.system), bounds);
  if (value.prompt !== undefined) {
    decodePrompt(wireObject(value.prompt), bounds);
  }
  decodeDropped(value.droppedContexts, bounds);
  decodeExcluded(value.excludedContexts, bounds);
  if (value.tools !== undefined) {
    const tools = boundedArray(value.tools, "tools");
    tools.forEach((tool) => boundedString(tool, 1, 512));
  }
}

function decodeSystem(value: WireObject, bounds: Bounds): void {
  exactWireKeys(value, ["text", "tokens", "coverage", "parts"]);
  const text = boundedString(value.text, 0, 1_048_576);
  nonnegativeSafeInteger(value.tokens);
  if (value.coverage !== "complete" && value.coverage !== "partial") {
    throw new Error("invalid coverage");
  }
  const included: string[] = [];
  boundedArray(value.parts, "parts").forEach((part) => {
    const object = wireObject(part);
    exactWireKeys(
      object,
      ["source", "text", "tokens", "skipped", "segments"],
      ["staticTokens", "dynamicTokens"],
    );
    boundedString(object.source, 1, 512);
    const partText = boundedString(object.text, 0, 1_048_576);
    nonnegativeSafeInteger(object.tokens);
    if (typeof object.skipped !== "boolean") throw new Error("invalid skipped");
    if (!object.skipped && partText !== "") included.push(partText);
    optionalCount(object.staticTokens);
    optionalCount(object.dynamicTokens);
    decodeSegments(object.segments, partText, bounds);
  });
  const coverage = included.join("\n\n") === text ? "complete" : "partial";
  if (value.coverage !== coverage) throw new Error("invalid system coverage");
}

function decodePrompt(value: WireObject, bounds: Bounds): void {
  exactWireKeys(
    value,
    ["text", "tokens", "segments"],
    ["staticTokens", "dynamicTokens"],
  );
  const text = boundedString(value.text, 0, 1_048_576);
  nonnegativeSafeInteger(value.tokens);
  optionalCount(value.staticTokens);
  optionalCount(value.dynamicTokens);
  decodeSegments(value.segments, text, bounds);
}

function decodeDropped(value: unknown, bounds: Bounds): void {
  boundedArray(value, "dropped contexts").forEach((item) => {
    const object = wireObject(item);
    exactWireKeys(object, ["source", "text", "tokens", "priority", "segments"]);
    boundedString(object.source, 1, 512);
    const text = boundedString(object.text, 0, 1_048_576);
    nonnegativeSafeInteger(object.tokens);
    finiteNumber(object.priority);
    decodeSegments(object.segments, text, bounds);
  });
}

function decodeExcluded(value: unknown, bounds: Bounds): void {
  boundedArray(value, "excluded contexts").forEach((item) => {
    const object = wireObject(item);
    exactWireKeys(object, ["source", "reason"]);
    boundedString(object.source, 1, 512);
    boundedString(object.reason, 0, 1024);
  });
}

function decodeSegments(value: unknown, text: string, bounds: Bounds): void {
  if (!Array.isArray(value)) throw new Error("invalid segments");
  bounds.segments += value.length;
  if (bounds.segments > MAX_SEGMENTS) throw new Error("segment limit");
  let cursor = 0;
  value.forEach((segment) => {
    const object = wireObject(segment);
    exactWireKeys(
      object,
      ["kind", "startUtf16", "endUtf16"],
      ["source", "observedAt", "sourceVersion"],
    );
    if (!["static", "dynamic", "unknown"].includes(String(object.kind))) {
      throw new Error("invalid segment kind");
    }
    const start = nonnegativeSafeInteger(object.startUtf16);
    const end = nonnegativeSafeInteger(object.endUtf16);
    if (
      start !== cursor ||
      end <= start ||
      end > text.length ||
      !isUtf16Boundary(text, start) ||
      !isUtf16Boundary(text, end)
    ) {
      throw new Error("invalid segment range");
    }
    if (object.source !== undefined) {
      boundedString(object.source, 1, 512);
    }
    if (object.observedAt !== undefined) {
      nonnegativeSafeInteger(object.observedAt);
    }
    if (object.sourceVersion !== undefined) {
      boundedString(object.sourceVersion, 1, 256);
    }
    cursor = end;
  });
  if (cursor !== text.length) throw new Error("incomplete segments");
}

function boundedArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  return wireString(value, minimum, maximum);
}

function optionalCount(value: unknown): void {
  if (value !== undefined) nonnegativeSafeInteger(value);
}

function isUtf16Boundary(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}
