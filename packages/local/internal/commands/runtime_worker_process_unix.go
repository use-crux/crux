//go:build !windows

package commands

import (
	"os"
	"os/exec"
)

func newRuntimeWorkerProcessCommand(node, script, root string) *exec.Cmd {
	cmd := exec.Command(node, script, root)
	cmd.Stdin = os.Stdin
	return cmd
}

func prepareRuntimeWorkerShutdown(*exec.Cmd) (func() error, error) {
	return nil, nil
}
