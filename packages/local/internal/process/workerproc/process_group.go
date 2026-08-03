package workerproc

import "os/exec"

// ProcessGroup owns the platform process-tree boundary for one worker.
type ProcessGroup struct {
	state *processGroupState
}

// ConfigureProcessGroup isolates a supervised worker and its descendants.
func ConfigureProcessGroup(cmd *exec.Cmd) (*ProcessGroup, error) {
	state, err := prepareProcessGroup(cmd)
	if err != nil {
		return nil, err
	}
	return &ProcessGroup{state: state}, nil
}

// Start starts the worker inside its configured process-tree boundary.
func (group *ProcessGroup) Start() error {
	return startProcessGroup(group.state)
}

// SignalProcessGroup requests graceful shutdown for a worker process tree.
func SignalProcessGroup(group *ProcessGroup) {
	signalConfiguredProcessGroup(group.state)
}

// KillProcessGroup forcibly stops a worker process tree.
func KillProcessGroup(group *ProcessGroup) {
	killConfiguredProcessGroup(group.state)
}

// CloseProcessGroup releases process-tree supervision resources.
func CloseProcessGroup(group *ProcessGroup) {
	if group != nil {
		closeProcessGroup(group.state)
	}
}
