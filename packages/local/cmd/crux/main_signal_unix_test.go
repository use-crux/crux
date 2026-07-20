//go:build linux || darwin || freebsd || openbsd || netbsd

package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

const signalHelperEnvironment = "CRUX_SIGNAL_HELPER"

func TestHandledSIGTERMExits143AfterCleanup(t *testing.T) {
	cmd, output, stderr := startSignalHelper(t, "finish")

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("send SIGTERM: %v", err)
	}
	if got := scanSignalHelperLine(t, output); got != "canceled" {
		t.Fatalf("helper cleanup = %q, want canceled", got)
	}
	err := cmd.Wait()
	exitErr, ok := err.(*exec.ExitError)
	if !ok || exitErr.ExitCode() != 143 {
		t.Fatalf("helper wait error = %v, want exit code 143", err)
	}
	if got := stderr.String(); got != "" {
		t.Fatalf("signal cancellation leaked to stderr: %q", got)
	}
}

func TestSecondSignalUsesRestoredDefaultHandling(t *testing.T) {
	cmd, output, _ := startSignalHelper(t, "wait-for-second")

	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatalf("send first SIGINT: %v", err)
	}
	if got := scanSignalHelperLine(t, output); got != "canceled" {
		t.Fatalf("helper after first signal = %q, want canceled", got)
	}
	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatalf("send second SIGINT: %v", err)
	}

	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()
	select {
	case err := <-wait:
		exitErr, ok := err.(*exec.ExitError)
		if !ok {
			t.Fatalf("helper wait error = %v, want signal exit", err)
		}
		status, ok := exitErr.Sys().(syscall.WaitStatus)
		if !ok || !status.Signaled() || status.Signal() != syscall.SIGINT {
			t.Fatalf("helper wait status = %v, want SIGINT termination", exitErr.Sys())
		}
	case <-time.After(2 * time.Second):
		_ = cmd.Process.Kill()
		<-wait
		t.Fatal("second signal did not terminate helper immediately")
	}
}

func TestCleanupFailureWithoutSignalExitsOne(t *testing.T) {
	cmd, _, stderr := startSignalHelper(t, "cleanup-error")
	err := cmd.Wait()
	exitErr, ok := err.(*exec.ExitError)
	if !ok || exitErr.ExitCode() != 1 {
		t.Fatalf("helper wait error = %v, want exit code 1", err)
	}
	if got := stderr.String(); !strings.Contains(got, "cleanup failed") {
		t.Fatalf("helper stderr = %q, want cleanup failure", got)
	}
}

func TestSignalStatusWinsOverCleanupFailure(t *testing.T) {
	cmd, output, stderr := startSignalHelper(t, "signal-cleanup-error")
	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatalf("send SIGINT: %v", err)
	}
	if got := scanSignalHelperLine(t, output); got != "canceled" {
		t.Fatalf("helper cleanup = %q, want canceled", got)
	}
	err := cmd.Wait()
	exitErr, ok := err.(*exec.ExitError)
	if !ok || exitErr.ExitCode() != 130 {
		t.Fatalf("helper wait error = %v, want exit code 130", err)
	}
	if got := stderr.String(); !strings.Contains(got, "cleanup failed") || strings.Contains(got, "context canceled") {
		t.Fatalf("helper stderr = %q, want cleanup failure without cancellation noise", got)
	}
}

func TestSignalHelperProcess(t *testing.T) {
	mode := os.Getenv(signalHelperEnvironment)
	if mode == "" {
		return
	}

	code := runWithSignalHandling(
		context.Background(),
		os.Stderr,
		processSignalNotifier{},
		func(ctx context.Context) error {
			fmt.Fprintln(os.Stdout, "ready")
			if mode == "cleanup-error" {
				return errors.New("cleanup failed")
			}
			<-ctx.Done()
			fmt.Fprintln(os.Stdout, "canceled")
			if mode == "wait-for-second" {
				time.Sleep(10 * time.Second)
			}
			if mode == "signal-cleanup-error" {
				return errors.Join(ctx.Err(), errors.New("cleanup failed"))
			}
			return ctx.Err()
		},
	)
	os.Exit(code)
}

func startSignalHelper(t *testing.T, mode string) (*exec.Cmd, *bufio.Scanner, *bytes.Buffer) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestSignalHelperProcess$")
	cmd.Env = append(os.Environ(), signalHelperEnvironment+"="+mode)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr := &bytes.Buffer{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(stdout)
	if got := scanSignalHelperLine(t, scanner); got != "ready" {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatalf("helper startup = %q, want ready", got)
	}
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	return cmd, scanner, stderr
}

func scanSignalHelperLine(t *testing.T, scanner *bufio.Scanner) string {
	t.Helper()
	if !scanner.Scan() {
		t.Fatalf("read helper output: %v", scanner.Err())
	}
	return scanner.Text()
}
