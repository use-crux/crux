//go:build windows

package workerproc

import "os/exec"

func configureProcessGroup(*exec.Cmd) {}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
