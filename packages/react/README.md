# @crux/react

React bindings for Crux plans, tasks, blackboards, working memory, and live transports.

This package owns browser/runtime UI integration only:

- `CruxProvider`
- plan/task/memory hooks
- polling, SSE, Convex, and mock transports
- `@crux/react/server` for the SSE handler

It intentionally does not define orchestration primitives. Those live in `@crux/core`.

## Install

```bash
pnpm add @crux/react @crux/core
```

## Usage

```tsx
import { CruxProvider, createSSETransport, usePlan } from '@crux/react'

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

Server-side SSE helpers are exported from `@crux/react/server`.

