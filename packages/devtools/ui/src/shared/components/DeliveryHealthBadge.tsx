import { Chip } from '@/qw/shell/primitives'
import { deliveryHealthTone } from '@/shared/lib/run-reliability'

/** Shared tri-state delivery-health badge for Runs and Run Detail. */
export function DeliveryHealthBadge({ status }: { status: string }) {
  const explanation =
    status === 'healthy'
      ? 'The server observed a clean terminal run with causal ordering and no gaps, conflicts, or rejected delivery.'
      : status === 'degraded'
        ? 'Some telemetry records were rejected or delivery could not complete cleanly.'
        : 'The server has not observed enough delivery evidence to call this run healthy or degraded.'
  return (
    <span title={explanation}>
      <Chip tone={deliveryHealthTone(status)} mono>
        delivery {status}
      </Chip>
    </span>
  )
}
