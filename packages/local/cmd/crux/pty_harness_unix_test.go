//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || zos

package main

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

func runCruxPTYHelp(t testing.TB) string {
	t.Helper()
	return runCruxPTY(t, []string{"--help"}, []string{"NO_COLOR=1", "TERM=dumb"})
}

func runCruxPTY(t testing.TB, args, environment []string) string {
	t.Helper()

	binary := buildCruxTestBinary(t)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()

	command := exec.CommandContext(ctx, binary, args...)
	command.Env = environment
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		t.Fatalf("start crux help in PTY: %v", err)
	}
	defer terminal.Close()

	transcript, readErr := io.ReadAll(terminal)
	waitErr := command.Wait()
	if ctx.Err() != nil {
		t.Fatalf("crux help in PTY did not exit: %v", ctx.Err())
	}
	if readErr != nil && !errors.Is(readErr, syscall.EIO) {
		t.Fatalf("read crux PTY help: %v", readErr)
	}
	if waitErr != nil {
		t.Fatalf("crux PTY help exit: %v\n%s", waitErr, transcript)
	}
	return string(transcript)
}
