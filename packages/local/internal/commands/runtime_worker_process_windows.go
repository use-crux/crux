//go:build windows

package commands

import (
	"errors"
	"os"
	"os/exec"
	"sync"
)

func newRuntimeWorkerProcessCommand(node, script, root string) *exec.Cmd {
	return exec.Command(node, "--import", runtimeWorkerStdinShutdownImport, script, root)
}

func prepareRuntimeWorkerShutdown(cmd *exec.Cmd) (func() error, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	var once sync.Once
	var closeErr error
	return func() error {
		once.Do(func() {
			closeErr = stdin.Close()
			if errors.Is(closeErr, os.ErrClosed) {
				closeErr = nil
			}
		})
		return closeErr
	}, nil
}
