# `@use-crux/next`

Next.js host integration for Crux request-scoped [`defer()`](https://cruxjs.dev).

## Install

```bash
pnpm add @use-crux/next @use-crux/core
```

Requires **Next.js 15.1+** (`after` from `next/server`).

## Usage

```ts
import { defer } from '@use-crux/core'
import { withCrux } from '@use-crux/next'

export const POST = withCrux(async () => {
  defer(() => {
    // Runs after the response finishes (response-finished class).
  })
  return Response.json({ ok: true })
})
```

Application code always imports `defer` from `@use-crux/core`. This package only
installs the Next lifetime boundary. `withCrux` also schedules a bounded final
observability drain through the same `after()` port without holding the response
open. Pass `onDrain` to inspect incomplete delivery. `withNextDefer` remains
available when only the low-level defer lifetime is wanted.

Named durable work still needs a configured Crux Runtime:

```ts
export const POST = withCrux(
  async () => {
    await defer(sendEmail, { messageId: '1' })
    return Response.json({ ok: true })
  },
  { durableFinalization: true },
)
```
