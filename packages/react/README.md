# @use-crux/react

React bindings for Crux plans, tasks, blackboards, working memory, and live transports.

This package owns browser/runtime UI integration only:

- `CruxProvider`
- plan/task/memory hooks
- polling, SSE, Convex, and mock transports
- `@use-crux/react/server` for the SSE handler

It intentionally does not define orchestration primitives. Those live in `@use-crux/core`.

## Install

```bash
pnpm add @use-crux/react @use-crux/core
```

## Usage

```tsx
import { CruxProvider, createSSETransport, usePlan } from '@use-crux/react'

const transport = createSSETransport('/api/crux/events')

export function App() {
  return (
    <CruxProvider transport={transport}>
      <PlanPanel />
    </CruxProvider>
  )
}

function PlanPanel() {
  const plan = usePlan('plan_123')
  return <pre>{JSON.stringify(plan, null, 2)}</pre>
}
```

Server-side SSE helpers are exported from `@use-crux/react/server`.

