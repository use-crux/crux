package workerproc

import (
	"errors"
	"os"
	"os/exec"
	"testing"
)

func TestSignalProcessGroupReportsGracefulShutdownFailure(t *testing.T) {
	want := errors.New("shutdown delivery failed")
	group := &ProcessGroup{
		cmd: &exec.Cmd{Process: &os.Process{Pid: 1}},
		gracefulShutdown: func() error {
			return want
		},
	}

	if err := SignalProcessGroup(group); !errors.Is(err, want) {
		t.Fatalf("SignalProcessGroup() error = %v, want %v", err, want)
	}
}
