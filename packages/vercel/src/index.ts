/** Vercel host retention binding for Crux deferred work. @module */

import { CruxDeferError, type CruxHostBinding } from "@use-crux/core";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

/** Bind ambient invocation retention to Vercel `waitUntil()`. */
export function vercel(): CruxHostBinding {
  return Object.freeze({
    kind: "vercel",
    invocationScope: true,
    supportsInline: true,
    durableFinalization: false,
    retain(work): void {
      if (typeof vercelWaitUntil !== "function") throw missingWaitUntil();
      vercelWaitUntil(work());
    },
  } satisfies CruxHostBinding);
}

function missingWaitUntil(): CruxDeferError {
  return new CruxDeferError({
    code: "DEFER_CAPABILITY_MISSING",
    message:
      "Vercel waitUntil() is required for @use-crux/vercel deferred work. Install a current @vercel/functions release or wrap the handler with an explicit supported host.",
  });
}
