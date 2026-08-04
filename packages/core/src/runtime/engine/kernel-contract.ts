/** Provider-neutral Runtime kernel operation contract. */

import type { RuntimeDeferredIntent } from "../ports/deferred";
import type { RuntimeTimerRecord } from "../store";
import type { WakeEnvelope } from "./envelope";
import type {
  CancelWorkInput,
  CancelWorkResult,
  EmitEventInput,
  EmitEventResult,
  EnqueueTaskInput,
  RetryWorkInput,
  RetryWorkResult,
  RuntimeWakeResult,
} from "./kernel-types";
import type {
  AbandonDeferredScopeInput,
  DeferredScopeTransitionResult,
  FinalizeDeferredScopeInput,
  RenewDeferredScopeLeaseInput,
  RenewDeferredScopeLeaseResult,
  StageDeferredIntentInput,
} from "./kernel-deferred";
import type {
  SignalPublishCompositeInput,
  SignalPublishCompositeResult,
} from "./composites/signal";
import type { FlowManualResumeInput } from "./composites/flow-manual-resume";
import type {
  WorkAcceptCompositeInput,
  WorkAcceptCompositeResult,
} from "./composites/work-accept";
import type {
  WorkProgressCompositeInput,
  WorkProgressCompositeResult,
} from "./composites/work-progress";
import type {
  WorkDetachCompositeInput,
  WorkDetachCompositeResult,
} from "./composites/work-detach";
import type {
  SessionInputsAcceptCompositeInput,
  SessionInputsAcceptCompositeResult,
} from "./composites/session-inputs-accept";
import type { RecordSuspensionInput } from "./kernel-flow-types";
import type {
  MaintenanceTickOptions,
  MaintenanceTickResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
} from "./kernel-timer-types";
import type { RuntimeWorkItem } from "./work";

/** Runtime kernel operations for durable work and wake handling. */
export interface RuntimeKernel {
  /** Atomically accept one top-level application Flow Work occurrence. */
  acceptWork(
    input: WorkAcceptCompositeInput,
  ): Promise<WorkAcceptCompositeResult>;
  /** Atomically accept ordered Session inputs and reserve at most one Work. */
  acceptSessionInputs(
    input: SessionInputsAcceptCompositeInput,
  ): Promise<SessionInputsAcceptCompositeResult>;
  /** Replace one live application Work progress snapshot. */
  progressWork(
    input: WorkProgressCompositeInput,
  ): Promise<WorkProgressCompositeResult>;
  /** Remove durable ownership without cancelling application Work. */
  detachWork(
    input: WorkDetachCompositeInput,
  ): Promise<WorkDetachCompositeResult>;
  /** Atomically arbitrate a manual Flow resume with its waiter and timer. */
  resumeFlow(input: FlowManualResumeInput): Promise<RuntimeWorkItem | null>;
  /** Atomically accept one Signal occurrence and every required delivery. */
  publishSignal(
    input: SignalPublishCompositeInput,
  ): Promise<SignalPublishCompositeResult>;
  /** Durably accept named deferred work without making it runnable. */
  stageDeferredIntent(
    input: StageDeferredIntentInput,
  ): Promise<RuntimeDeferredIntent>;
  /** Atomically finalize an invocation and release all staged siblings. */
  finalizeDeferredScope(
    input: FinalizeDeferredScopeInput,
  ): Promise<DeferredScopeTransitionResult>;
  /** Atomically abandon an unfinalized invocation and all staged siblings. */
  abandonDeferredScope(
    input: AbandonDeferredScopeInput,
  ): Promise<DeferredScopeTransitionResult>;
  /** Renew or fence the durable deferred scope lease token/expiry. */
  renewDeferredScopeLease(
    input: RenewDeferredScopeLeaseInput,
  ): Promise<RenewDeferredScopeLeaseResult>;
  /** Create pending task work and write its wake envelope to the outbox. */
  enqueueTask(input: EnqueueTaskInput): Promise<RuntimeWorkItem>;
  /** Persist a flow suspension and owned waiter registrations atomically. */
  recordSuspension(input: RecordSuspensionInput): Promise<void>;
  /** Append an event and resume all matching waiters that win the CAS race. */
  emitEvent(input: EmitEventInput): Promise<EmitEventResult>;
  /** Cancel non-terminal work and its owned waiter/timer registrations. */
  cancelWork(input: CancelWorkInput): Promise<CancelWorkResult>;
  /** Retry blocked or dead-lettered work after an operator believes the cause is fixed. */
  retryWork(input: RetryWorkInput): Promise<RetryWorkResult>;
  /** Persist a store-backed timer record. */
  scheduleTimer(input: ScheduleTimerInput): Promise<RuntimeTimerRecord>;
  /** Fire due store-backed timers through the waiter CAS race gate. */
  scanTimers(options?: ScanTimersOptions): Promise<ScanTimersResult>;
  /** Run one kernel-owned maintenance pass. */
  maintenanceTick(
    options?: MaintenanceTickOptions,
  ): Promise<MaintenanceTickResult>;
  /** Handle one verified wake envelope through lease, execution, and commit. */
  handleWake(envelope: WakeEnvelope): Promise<RuntimeWakeResult>;
}
