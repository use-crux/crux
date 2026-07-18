/** Web-safe fingerprinting for portable Eval contracts. @internal */

import { sha256Hex } from "../../../content/sha256";
import { canonicalFingerprintJson } from "./canonical-fingerprint";

export function fingerprintPortableValue(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalFingerprintJson(value)));
}
