package projectwatch

type queueState struct {
	running bool
	pending Delta
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
	delta  Delta
}

func enqueueDelta(state queueState, delta Delta) queueTransition {
	if deltaEmpty(delta) {
		return queueTransition{state: state, action: queueActionIdle}
	}
	if state.running {
		state.pending = mergeDelta(state.pending, delta)
		return queueTransition{state: state, action: queueActionIdle}
	}
	state.running = true
	return queueTransition{state: state, action: queueActionStart, delta: delta}
}

func completeRun(state queueState) queueTransition {
	if deltaEmpty(state.pending) {
		state.running = false
		return queueTransition{state: state, action: queueActionIdle}
	}
	next := state.pending
	state.pending = Delta{}
	state.running = true
	return queueTransition{state: state, action: queueActionContinue, delta: next}
}

func deltaEmpty(delta Delta) bool {
	return len(delta.Files) == 0 && len(delta.DeletedFiles) == 0
}
