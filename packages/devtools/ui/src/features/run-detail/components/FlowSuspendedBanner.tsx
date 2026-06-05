/**
 * Suspended-flow banner (design `v9` `ArchFlow`).
 *
 * A durable flow paused on a signal / event / timer / child run shows this
 * notice above the lens body whenever the run status is `suspended`, so the
 * paused state is obvious regardless of the active lens.
 *
 * Informational only: devtools *observes* the runtime, it doesn't drive it —
 * there is no Resume/Cancel mutation here (the run resumes in the app runtime
 * when its awaited condition is met).
 */

import { Icon } from '@/qw/shell/Icon'
import { findAttribute } from '@/features/run-detail/lib/span-detail-inspection'
import type { ObservabilityRunDetailNode } from '@/types'

/** First span that names a suspend point (durable flow await), depth-first. */
function findSuspendPoint(node: ObservabilityRunDetailNode | undefined): string | undefined {
  if (!node) return undefined
  const sp = findAttribute(node, 'suspendPoint', 'suspend_point')
  if (typeof sp === 'string' && sp) return sp
  for (const child of node.children ?? []) {
    const found = findSuspendPoint(child)
    if (found) return found
  }
  return undefined
}

export function FlowSuspendedBanner({ root }: { root?: ObservabilityRunDetailNode }) {
  const suspendPoint = findSuspendPoint(root)
  return (
    <div
      className="flex flex-shrink-0 items-center gap-3 px-6 py-3"
      style={{ background: 'var(--qw-crux-soft)', borderBottom: '1px solid var(--qw-crux-line)' }}
    >
      <Icon name="clock" size={16} color="var(--qw-crux)" />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">
          {suspendPoint ? (
            <>
              Suspended at <span className="font-mono">{suspendPoint}</span>
            </>
          ) : (
            'Flow suspended'
          )}
        </div>
        <div className="text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
          This durable flow is paused — awaiting a signal, event, timer, or child run. It resumes when the
          awaited condition is met.
        </div>
      </div>
    </div>
  )
}
