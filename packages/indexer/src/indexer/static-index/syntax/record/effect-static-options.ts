import { createHash } from "node:crypto";
import type {
  EffectFacts,
  EffectStaticPresence,
} from "@use-crux/core/project-index";
import { safeId } from "../../../definitions";
import type { StaticObjectValue, StaticSyntaxValue } from "./types";

/** Projects the statically certain public Effect option facts. */
export function effectFacts(
  effectId: string | undefined,
  options: StaticObjectValue | undefined,
  hasOptions: boolean,
): EffectFacts {
  const versionProperty = effectiveProperty(options, "version");
  const version = options
    ? versionProperty.kind === "absent"
      ? 1
      : versionProperty.kind === "known"
        ? literalNumber(versionProperty.value)
        : undefined
    : hasOptions
      ? undefined
      : 1;
  const recover = effectiveProperty(options, "recover");
  const resource = effectiveProperty(options, "resource");
  const unknownOptions = options === undefined && hasOptions;
  return {
    kind: "effect",
    ...(effectId === undefined ? {} : { effectId }),
    ...(version === undefined ? {} : { version }),
    recoverable: presence(recover, unknownOptions),
    capture: capturePresence(recover, unknownOptions),
    resource: presence(resource, unknownOptions),
  };
}

export function objectValue(
  value: StaticSyntaxValue | undefined,
): StaticObjectValue | undefined {
  return value?.kind === "object" ? value : undefined;
}

export function literalString(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

export function pathIdentity(relativePath: string): string {
  const hash = createHash("sha256").update(relativePath).digest("hex");
  return `${safeId(relativePath)}:${hash.slice(0, 16)}`;
}

type EffectiveProperty =
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly value: StaticSyntaxValue };

function effectiveProperty(
  object: StaticObjectValue | undefined,
  name: string,
): EffectiveProperty {
  if (!object) return { kind: "absent" };
  let result: EffectiveProperty = { kind: "absent" };
  for (const item of object.properties) {
    if (item.spread === true) result = { kind: "unknown" };
    else if (item.name === name) result = { kind: "known", value: item.value };
  }
  return result;
}

function presence(
  property: EffectiveProperty,
  hasUnknownContainer: boolean,
): EffectStaticPresence {
  if (property.kind === "known") return true;
  if (property.kind === "unknown" || hasUnknownContainer) return "unknown";
  return false;
}

function capturePresence(
  recover: EffectiveProperty,
  hasUnknownContainer: boolean,
): EffectStaticPresence {
  if (
    recover.kind === "unknown" ||
    (hasUnknownContainer && recover.kind === "absent")
  ) {
    return "unknown";
  }
  if (recover.kind === "absent") return false;
  const recoverObject = objectValue(recover.value);
  if (!recoverObject) {
    return recover.value.kind === "function" ? false : "unknown";
  }
  const capture = effectiveProperty(recoverObject, "capture");
  const execute = effectiveProperty(recoverObject, "execute");
  if (capture.kind === "known" && execute.kind === "known") return true;
  if (capture.kind === "unknown" || execute.kind === "unknown") {
    return "unknown";
  }
  return false;
}

function literalNumber(
  value: StaticSyntaxValue | undefined,
): number | undefined {
  return value?.kind === "literal" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
    ? value.value
    : undefined;
}
