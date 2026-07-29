import type { PromptPreviewChoice, PromptPreviewDiscovery } from "../types";
import {
  exactWireKeys,
  optionalWireString,
  positiveSafeInteger,
  wireEnvironment,
  wireJsonObject,
  wireObject,
  wireString,
} from "./common";

const reasons = new Set([
  "owner-not-found",
  "owner-not-prompt",
  "no-peer",
  "capability-unavailable",
  "target-unavailable",
  "projection-limit-exceeded",
]);

/** Strictly decode one browser-safe discovery projection. */
export function decodePromptPreviewDiscovery(
  value: unknown,
): PromptPreviewDiscovery {
  const object = wireObject(value);
  if (object.status === "ready") {
    exactWireKeys(object, ["status", "projectionRevision", "owner", "choices"]);
    const owner = wireObject(object.owner);
    exactWireKeys(owner, ["definitionId", "kind", "name"], ["description"]);
    if (owner.kind !== "prompt") throw new Error("invalid owner kind");
    wireString(owner.definitionId, 1, 512);
    wireString(owner.name, 1, 512);
    optionalWireString(owner.description, 4096);
    positiveSafeInteger(object.projectionRevision);
    if (
      !Array.isArray(object.choices) ||
      object.choices.length < 1 ||
      object.choices.length > 32
    ) {
      throw new Error("invalid runtime choices");
    }
    object.choices.forEach(decodeChoice);
    return object as PromptPreviewDiscovery;
  }
  if (object.status === "unavailable") {
    exactWireKeys(object, [
      "status",
      "projectionRevision",
      "reason",
      "message",
    ]);
    positiveSafeInteger(object.projectionRevision);
    if (!reasons.has(String(object.reason))) {
      throw new Error("invalid unavailable reason");
    }
    wireString(object.message, 1, 4096);
    return object as PromptPreviewDiscovery;
  }
  throw new Error("invalid discovery status");
}

function decodeChoice(value: unknown): PromptPreviewChoice {
  const object = wireObject(value);
  exactWireKeys(object, [
    "peerId",
    "runtimeName",
    "environment",
    "catalogueRevision",
    "target",
  ]);
  wireString(object.peerId, 1, 128);
  wireString(object.runtimeName, 1, 256);
  wireEnvironment(object.environment);
  positiveSafeInteger(object.catalogueRevision);
  const target = wireObject(object.target);
  exactWireKeys(target, ["name", "input"], ["description"]);
  wireString(target.name, 1, 512);
  optionalWireString(target.description, 4096);
  const input = wireObject(target.input);
  if (input.mode === "none" || input.mode === "raw") {
    exactWireKeys(input, ["mode"]);
  } else if (input.mode === "schema") {
    exactWireKeys(input, ["mode", "schema"]);
    wireJsonObject(input.schema);
  } else {
    throw new Error("invalid input mode");
  }
  return object as unknown as PromptPreviewChoice;
}
