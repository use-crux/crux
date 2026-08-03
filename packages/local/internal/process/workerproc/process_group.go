package workerproc

import "os/exec"

// ProcessGroup owns the platform process-tree boundary for one worker.
type ProcessGroup struct {
	cmd              *exec.Cmd
	state            *processGroupState
	gracefulShutdown func() error
}

// ConfigureProcessGroup isolates a supervised worker and its descendants.
func ConfigureProcessGroup(cmd *exec.Cmd, gracefulShutdown func() error) (*ProcessGroup, error) {
	state, err := prepareProcessGroup(cmd)
	if err != nil {
		return nil, err
	}
	return &ProcessGroup{cmd: cmd, state: state, gracefulShutdown: gracefulShutdown}, nil
}

// Start starts the worker inside its configured process-tree boundary.
func (group *ProcessGroup) Start() error {
	return startProcessGroup(group.state)
}

// SignalProcessGroup requests graceful shutdown for a worker process tree and
// reports whether the request reached its delivery boundary.
func SignalProcessGroup(group *ProcessGroup) error {
	if group == nil || group.cmd == nil || group.cmd.Process == nil {
		return nil
	}
	if group.gracefulShutdown != nil {
		return group.gracefulShutdown()
	}
	return signalConfiguredProcessGroup(group.state)
}

// KillProcessGroup forcibly stops a worker process tree.
func KillProcessGroup(group *ProcessGroup) {
	if group != nil {
		killConfiguredProcessGroup(group.state)
	}
}

// CloseProcessGroup releases process-tree supervision resources.
func CloseProcessGroup(group *ProcessGroup) {
	if group != nil {
		closeProcessGroup(group.state)
	}
}
