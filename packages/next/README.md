# `@use-crux/next`

Next.js host integration for Crux request-scoped [`defer()`](https://cruxjs.dev).

## Install

```bash
pnpm add @use-crux/next @use-crux/core
```

Requires **Next.js 15.1+** (`after` from `next/server`).

## Usage

```ts
import { config } from "@use-crux/core";
import { next } from "@use-crux/next";

export default config({ host: next() });
```

Application code always imports `defer` from `@use-crux/core`. Inside Crux
primitives, work starts at the nearest scope close and `next()` retains the root
through Next `after()`. Root-level calls use one ephemeral invocation per call.

Use `withCrux` when a route needs one grouped invocation, outcome
classification, strict response commit, and the bounded observability drain:

```ts
import { defer } from "@use-crux/core";
import { withCrux } from "@use-crux/next";

export const POST = withCrux(async () => {
  defer(() => flushAnalytics());
  return Response.json({ ok: true });
});
```

Pass `onDrain` to inspect incomplete observability delivery. `withNextDefer`
remains the defer-only strict boundary.

Named durable work still needs a configured Crux Runtime:

```ts
export const POST = withCrux(
  async () => {
    await defer(sendEmail, { messageId: "1" });
    return Response.json({ ok: true });
  },
  { durableFinalization: true },
);
```
