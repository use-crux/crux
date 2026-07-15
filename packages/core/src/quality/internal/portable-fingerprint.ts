/** Web-safe fingerprinting for portable Quality/Eval contracts. @internal */

import { sha256Hex } from "../../content/sha256";
import { canonicalJson } from "./canonical-json";

export function fingerprintPortableValue(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}
