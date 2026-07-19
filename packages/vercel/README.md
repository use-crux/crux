# `@use-crux/vercel`

Vercel invocation retention for Crux deferred work.

```ts
import { config } from "@use-crux/core";
import { vercel } from "@use-crux/vercel";

export default config({ host: vercel() });
```

Requires `@vercel/functions`; retained work is handed to `waitUntil()`.
