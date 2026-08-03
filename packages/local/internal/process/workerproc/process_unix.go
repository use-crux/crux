//go:build !windows

package workerproc

import (
	"os/exec"
	"syscall"
)

type processGroupState struct {
	cmd *exec.Cmd
}

func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func prepareProcessGroup(cmd *exec.Cmd) (*processGroupState, error) {
	configureProcessGroup(cmd)
	return &processGroupState{cmd: cmd}, nil
}

func startProcessGroup(group *processGroupState) error {
	return group.cmd.Start()
}

func signalConfiguredProcessGroup(group *processGroupState) error {
	return signalProcessGroup(group.cmd)
}

func signalProcessGroup(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}

func killConfiguredProcessGroup(group *processGroupState) {
	killProcessGroup(group.cmd)
}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

func closeProcessGroup(*processGroupState) {}
