package commands

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestRuntimeWorkerStdinShutdownSurvivesStartupRace(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	program := `
const guard = setTimeout(() => { process.exitCode = 2 }, 1000)
setTimeout(() => {
  process.once('SIGTERM', () => {
    clearTimeout(guard)
    process.stdout.write('stopped')
  })
}, 50)
`
	cmd := exec.Command(node, "--import", runtimeWorkerStdinShutdownImport, "--input-type=module", "--eval", program)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("worker protocol process: %v\n%s", err, output.String())
	}
	if got := output.String(); got != "stopped" {
		t.Fatalf("worker protocol output = %q, want stopped", got)
	}
}

func TestRuntimeWorkerStdinShutdownDoesNotKeepProcessAlive(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	cmd := exec.Command(node, "--import", runtimeWorkerStdinShutdownImport, "--eval", "")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		<-done
		t.Fatal("stdin shutdown protocol kept an otherwise complete process alive")
	}
}
