import {
  exactWireKeys,
  nonnegativeSafeInteger,
  wireObject,
  wireString,
  type WireObject,
} from "./common";

const MAX_ITEMS = 1_024;
const representations = new Set([
  "full",
  "authored",
  "summary",
  "offload",
  "omitted",
]);

/** Validate one complete redacted request-preview result. */
export function decodeReadyPreview(value: WireObject): void {
  exactWireKeys(value, ["preview", "contributions"]);
  decodePreview(wireObject(value.preview));
  boundedArray(value.contributions).forEach((entry) => {
    const contribution = wireObject(entry);
    exactWireKeys(contribution, ["id", "boundary", "representations"]);
    wireString(contribution.id, 1, 512);
    if (
      !["required", "sticky", "elastic"].includes(String(contribution.boundary))
    ) {
      throw new Error("invalid contribution boundary");
    }
    const rungs = boundedArray(contribution.representations, 5);
    if (
      rungs.length === 0 ||
      rungs.some((rung) => !representations.has(String(rung)))
    ) {
      throw new Error("invalid contribution representations");
    }
  });
}

function decodePreview(value: WireObject): void {
  exactWireKeys(
    value,
    ["status", "measurement", "adaptations", "warnings", "diagnostics"],
    ["model", "inputTokens", "maxInputTokens"],
  );
  if (!["fits", "over-limit", "unknown"].includes(String(value.status))) {
    throw new Error("invalid preview status");
  }
  if (
    !["exact", "estimated", "conservative", "incomplete"].includes(
      String(value.measurement),
    )
  ) {
    throw new Error("invalid preview measurement");
  }
  if (value.model !== undefined) wireString(value.model, 0, 512);
  if (value.inputTokens !== undefined)
    nonnegativeSafeInteger(value.inputTokens);
  if (value.maxInputTokens !== undefined)
    nonnegativeSafeInteger(value.maxInputTokens);
  boundedArray(value.adaptations).forEach(decodeAdaptation);
  boundedArray(value.warnings).forEach(decodeWarning);
  boundedArray(value.diagnostics).forEach(decodeDiagnostic);
}

function decodeAdaptation(value: unknown): void {
  const adaptation = wireObject(value);
  exactWireKeys(
    adaptation,
    ["contributor", "representation", "state"],
    ["fullTokens", "selectedTokens"],
  );
  wireString(adaptation.contributor, 1, 512);
  if (
    !["authored", "summary", "offload", "omitted"].includes(
      String(adaptation.representation),
    )
  ) {
    throw new Error("invalid adaptation representation");
  }
  if (adaptation.state !== "selected" && adaptation.state !== "unprepared") {
    throw new Error("invalid adaptation state");
  }
  if (adaptation.fullTokens !== undefined)
    nonnegativeSafeInteger(adaptation.fullTokens);
  if (adaptation.selectedTokens !== undefined)
    nonnegativeSafeInteger(adaptation.selectedTokens);
}

function decodeWarning(value: unknown): void {
  const warning = wireObject(value);
  exactWireKeys(warning, ["code", "message"]);
  wireString(warning.code, 1, 128);
  wireString(warning.message, 0, 2_048);
}

function decodeDiagnostic(value: unknown): void {
  const diagnostic = wireObject(value);
  exactWireKeys(
    diagnostic,
    ["id", "code", "message"],
    ["contributor", "tokens"],
  );
  wireString(diagnostic.id, 1, 512);
  wireString(diagnostic.code, 1, 128);
  wireString(diagnostic.message, 0, 2_048);
  if (diagnostic.contributor !== undefined)
    wireString(diagnostic.contributor, 1, 512);
  if (diagnostic.tokens !== undefined)
    nonnegativeSafeInteger(diagnostic.tokens);
}

function boundedArray(value: unknown, maximum = MAX_ITEMS): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error("invalid preview collection");
  }
  return value;
}
