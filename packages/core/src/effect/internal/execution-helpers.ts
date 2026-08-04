/** Small custom Effect execution guards. @internal @module */

import { CruxEffectError } from "../errors";
import { isEffectJsonSafe } from "./json-safety";

/** Whether an optional value can be retained by a durable envelope. */
export function isOptionalEffectJsonSafe(value: unknown): boolean {
  return value === undefined || isEffectJsonSafe(value);
}

/** Wrap a resource or capture failure in the public Effects diagnostic. */
export function effectPreparationError(
  code: "EFFECT_RESOURCE_FAILED" | "EFFECT_CAPTURE_FAILED",
  message: string,
  cause: unknown,
): CruxEffectError {
  return new CruxEffectError({ code, message, cause });
}
