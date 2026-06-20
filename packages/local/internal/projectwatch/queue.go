package projectwatch

type queueState struct {
	running   bool
	nextRunID uint64
	pending   queuedRun
}

type queueAction string

const (
	queueActionIdle     queueAction = "idle"
	queueActionStart    queueAction = "start"
	queueActionContinue queueAction = "continue"
)

type queueTransition struct {
	state  queueState
	action queueAction
	run    Run
}

type queuedRun struct {
	delta Delta
	queue RunQueueStats
}

func enqueueDelta(state queueState, delta Delta) queueTransition {
	if deltaEmpty(delta) {
		return queueTransition{state: state, action: queueActionIdle}
	}
	state = ensureNextRunID(state)
	if state.running {
		state.pending = mergeQueuedRun(state.pending, delta)
		return queueTransition{state: state, action: queueActionIdle}
	}
	state.running = true
	run := Run{
		ID:    state.nextRunID,
		Delta: delta,
		Queue: RunQueueStats{DeltaBatchCount: 1},
	}
	state.nextRunID++
	return queueTransition{state: state, action: queueActionStart, run: run}
}

func completeRun(state queueState) queueTransition {
	state = ensureNextRunID(state)
	if deltaEmpty(state.pending.delta) {
		state.running = false
		return queueTransition{state: state, action: queueActionIdle}
	}
	next := state.pending
	state.pending = queuedRun{}
	state.running = true
	run := Run{
		ID:    state.nextRunID,
		Delta: next.delta,
		Queue: next.queue,
	}
	state.nextRunID++
	return queueTransition{state: state, action: queueActionContinue, run: run}
}

func deltaEmpty(delta Delta) bool {
	return len(delta.Files) == 0 && len(delta.DeletedFiles) == 0
}

func ensureNextRunID(state queueState) queueState {
	if state.nextRunID == 0 {
		state.nextRunID = 1
	}
	return state
}

func mergeQueuedRun(pending queuedRun, delta Delta) queuedRun {
	if deltaEmpty(pending.delta) {
		return queuedRun{
			delta: delta,
			queue: RunQueueStats{
				DeltaBatchCount:       1,
				CoalescedWhileRunning: true,
			},
		}
	}
	pending.delta = mergeDelta(pending.delta, delta)
	pending.queue.DeltaBatchCount++
	pending.queue.CoalescedWhileRunning = true
	pending.queue.PendingRunReplacedCount++
	return pending
}
