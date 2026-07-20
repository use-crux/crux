//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || zos

package main

import (
	"bytes"
	"errors"
	"net"
	"os"
	"os/exec"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	xterm "github.com/charmbracelet/x/term"
	"github.com/creack/pty"
)

func TestPTYDevShutdownExitContract(t *testing.T) {
	tests := []struct {
		name     string
		stop     func(*ptyDevSession) error
		exitCode int
	}{
		{name: "q", stop: func(session *ptyDevSession) error { return session.write([]byte("q")) }, exitCode: 0},
		{name: "raw Ctrl+C", stop: func(session *ptyDevSession) error { return session.write([]byte{3}) }, exitCode: 130},
		{name: "SIGINT", stop: func(session *ptyDevSession) error { return session.command.Process.Signal(os.Interrupt) }, exitCode: 130},
		{name: "SIGTERM", stop: func(session *ptyDevSession) error { return session.command.Process.Signal(syscall.SIGTERM) }, exitCode: 143},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session := startPTYDev(t)
			session.waitFor(t, "Overview", 20*time.Second)
			if err := test.stop(session); err != nil {
				t.Fatalf("stop crux dev: %v", err)
			}
			session.waitExit(t, test.exitCode, 10*time.Second)

			transcript := session.output()
			if strings.Contains(transcript, "context canceled") {
				t.Fatalf("expected cancellation leaked into terminal output:\n%s", transcript)
			}
			if !strings.Contains(transcript, "Workbench closed. Dev server stopped.") {
				t.Fatalf("shutdown completion missing from terminal output:\n%s", transcript)
			}
			session.assertTerminalRestored(t)
			session.assertPortReleased(t)
		})
	}
}

type ptyDevSession struct {
	command    *exec.Cmd
	terminal   *os.File
	mu         sync.Mutex
	transcript bytes.Buffer
	changed    chan struct{}
	readDone   chan error
	waitDone   chan error
	initialTTY *xterm.State
	port       int
}

func startPTYDev(t *testing.T) *ptyDevSession {
	return startPTYDevAtSize(t, pty.Winsize{Rows: 30, Cols: 100})
}

func startPTYDevWithOptions(t *testing.T, extraArgs []string, environment map[string]string) *ptyDevSession {
	return startPTYDevWithOptionsAndSize(t, extraArgs, environment, pty.Winsize{Rows: 30, Cols: 100})
}

func startPTYDevAtSize(t *testing.T, size pty.Winsize) *ptyDevSession {
	return startPTYDevWithOptionsAndSize(t, nil, nil, size)
}

func startPTYDevWithOptionsAndSize(t *testing.T, extraArgs []string, environment map[string]string, size pty.Winsize) *ptyDevSession {
	t.Helper()
	directory := t.TempDir()
	port := availablePTYPort(t)
	args := []string{"dev", "--port", strconv.Itoa(port)}
	args = append(args, extraArgs...)
	command := exec.Command(buildCruxTestBinary(t), args...)
	command.Dir = directory
	command.Env = ptyDevEnvironment(directory, environment)
	terminal, tty, err := pty.Open()
	if err != nil {
		t.Fatalf("open crux dev PTY: %v", err)
	}
	initialTTY, err := xterm.GetState(terminal.Fd())
	if err != nil {
		_ = terminal.Close()
		_ = tty.Close()
		t.Fatalf("capture initial PTY state: %v", err)
	}
	if err := pty.Setsize(terminal, &size); err != nil {
		_ = terminal.Close()
		_ = tty.Close()
		t.Fatalf("size crux dev PTY: %v", err)
	}
	command.Stdin = tty
	command.Stdout = tty
	command.Stderr = tty
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	if err := command.Start(); err != nil {
		_ = terminal.Close()
		_ = tty.Close()
		t.Fatalf("start crux dev in PTY: %v", err)
	}
	_ = tty.Close()

	session := &ptyDevSession{
		command:    command,
		terminal:   terminal,
		changed:    make(chan struct{}, 1),
		readDone:   make(chan error, 1),
		waitDone:   make(chan error, 1),
		initialTTY: initialTTY,
		port:       port,
	}
	go session.read()
	go func() { session.waitDone <- command.Wait() }()
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_ = terminal.Close()
	})
	return session
}

func (session *ptyDevSession) assertRunning(t *testing.T) {
	t.Helper()
	if err := session.command.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("crux dev exited while the active filter owned q: %v\n%s", err, session.output())
	}
}

func (session *ptyDevSession) assertPortReleased(t *testing.T) {
	t.Helper()
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(session.port)))
	if err != nil {
		t.Fatalf("dev listener on port %d was not released: %v", session.port, err)
	}
	_ = listener.Close()
}

func (session *ptyDevSession) read() {
	buffer := make([]byte, 4096)
	for {
		count, err := session.terminal.Read(buffer)
		if count > 0 {
			session.mu.Lock()
			_, _ = session.transcript.Write(buffer[:count])
			session.mu.Unlock()
			select {
			case session.changed <- struct{}{}:
			default:
			}
		}
		if err != nil {
			session.readDone <- err
			return
		}
	}
}

func (session *ptyDevSession) waitFor(t *testing.T, value string, timeout time.Duration) {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for !strings.Contains(session.output(), value) {
		select {
		case <-session.changed:
		case err := <-session.waitDone:
			t.Fatalf("crux dev exited before %q: %v\n%s", value, err, session.output())
		case <-timer.C:
			t.Fatalf("timed out waiting for %q:\n%s", value, session.output())
		}
	}
}

func (session *ptyDevSession) waitExit(t *testing.T, want int, timeout time.Duration) {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	var err error
	select {
	case err = <-session.waitDone:
	case <-timer.C:
		t.Fatalf("crux dev did not exit:\n%s", session.output())
	}
	if got := processExitCode(err); got != want {
		t.Fatalf("crux dev exit code = %d, want %d: %v\n%s", got, want, err, session.output())
	}
	select {
	case readErr := <-session.readDone:
		if readErr != nil && !errors.Is(readErr, syscall.EIO) && !errors.Is(readErr, os.ErrClosed) {
			t.Fatalf("read crux dev PTY: %v", readErr)
		}
	case <-time.After(time.Second):
		_ = session.terminal.Close()
	}
}

func (session *ptyDevSession) write(value []byte) error {
	_, err := session.terminal.Write(value)
	return err
}

func (session *ptyDevSession) output() string {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.transcript.String()
}

func (session *ptyDevSession) assertTerminalRestored(t *testing.T) {
	t.Helper()
	current, err := xterm.GetState(session.terminal.Fd())
	if err != nil {
		t.Fatalf("capture restored PTY state: %v", err)
	}
	if !reflect.DeepEqual(current, session.initialTTY) {
		t.Fatal("crux dev left the PTY in a modified terminal mode")
	}
}

func processExitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

func availablePTYPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve PTY test port: %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func ptyDevEnvironment(directory string, overrides map[string]string) []string {
	excluded := map[string]struct{}{
		"CI": {}, "GITHUB_ACTIONS": {}, "BUILDKITE": {}, "GITLAB_CI": {},
		"CIRCLECI": {}, "TEAMCITY_VERSION": {}, "TERM": {}, "NO_COLOR": {},
		"XDG_CONFIG_HOME": {}, "XDG_CACHE_HOME": {}, "XDG_DATA_HOME": {},
	}
	environment := make([]string, 0, len(os.Environ())+5)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, overridden := overrides[key]; overridden {
			continue
		}
		if _, skip := excluded[key]; !skip {
			environment = append(environment, entry)
		}
	}
	environment = append(environment,
		"TERM=xterm-256color",
		"NO_COLOR=1",
		"XDG_CONFIG_HOME="+directory,
		"XDG_CACHE_HOME="+directory,
		"XDG_DATA_HOME="+directory,
	)
	for key, value := range overrides {
		environment = append(environment, key+"="+value)
	}
	return environment
}
