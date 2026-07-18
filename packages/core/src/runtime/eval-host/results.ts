import { sha256Hex } from "../../content/sha256";
import { canonicalRuntimeResult } from "../results/canonical";

/** Canonicalize and hash one private Eval-host result payload. */
export { canonicalRuntimeResult };

/** Build an adapter-owned opaque result location without exposing a namespace. */
export function createRuntimeResultLocation(
  adapter: string,
  namespace: string,
  sha256: string,
): string {
  const namespaceHash = sha256Hex(new TextEncoder().encode(namespace));
  return `${adapter}:${namespaceHash}:sha256:${sha256}`;
}
