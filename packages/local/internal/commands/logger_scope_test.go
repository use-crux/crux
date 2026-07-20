package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestConfigInspectDoesNotReplaceProcessLogger(t *testing.T) {
	t.Setenv("CRUX_STARTUP_DEBUG", "")
	previousResolver := resolveProjectConfigForInspect
	t.Cleanup(func() { resolveProjectConfigForInspect = previousResolver })

	started := make(chan struct{})
	finish := make(chan struct{})
	resolveProjectConfigForInspect = func(context.Context, string, string, string, commandWorkerProcess) (json.RawMessage, error) {
		close(started)
		<-finish
		return loadedConfigFixture(t.TempDir()), nil
	}

	previousLogger := slog.Default()
	var logOutput bytes.Buffer
	processLogger := slog.New(slog.NewTextHandler(&logOutput, nil))
	slog.SetDefault(processLogger)
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	cmd := NewConfigCmd(&cli.Factory{})
	cmd.SetArgs([]string{"inspect", "--json", "--cwd", t.TempDir()})
	cmd.SetOut(&strings.Builder{})
	cmd.SetErr(&strings.Builder{})
	done := make(chan error, 1)
	go func() { done <- cmd.Execute() }()

	<-started
	slog.Info("concurrent process log")
	close(finish)
	if err := <-done; err != nil {
		t.Fatalf("config inspect: %v", err)
	}
	if slog.Default() != processLogger {
		t.Fatal("config inspect replaced the process-global logger")
	}
	if !strings.Contains(logOutput.String(), "concurrent process log") {
		t.Fatalf("concurrent process log was redirected by config inspect: %q", logOutput.String())
	}
}

func TestRuntimeOperationDoesNotReplaceProcessLogger(t *testing.T) {
	t.Setenv("CRUX_STARTUP_DEBUG", "")
	previousRunner := runRuntimeOperationForCommand
	t.Cleanup(func() { runRuntimeOperationForCommand = previousRunner })

	started := make(chan struct{})
	finish := make(chan struct{})
	runRuntimeOperationForCommand = func(context.Context, string, string, string, commandWorkerProcess) (json.RawMessage, error) {
		close(started)
		<-finish
		return json.RawMessage(`{"operation":"status","ok":true,"namespace":"local","counts":[]}`), nil
	}

	assertCommandKeepsProcessLogger(t, started, finish, func() error {
		cmd := NewRuntimeCmd(&cli.Factory{})
		cmd.SetArgs([]string{"--json", "--cwd", t.TempDir(), "status"})
		cmd.SetOut(&strings.Builder{})
		cmd.SetErr(&strings.Builder{})
		return cmd.Execute()
	})
}

func TestRuntimeGenerateDoesNotReplaceProcessLogger(t *testing.T) {
	t.Setenv("CRUX_STARTUP_DEBUG", "")
	previousGenerator := generateRuntimeArtifactsForCommand
	t.Cleanup(func() { generateRuntimeArtifactsForCommand = previousGenerator })

	started := make(chan struct{})
	finish := make(chan struct{})
	generateRuntimeArtifactsForCommand = func(context.Context, string, commandWorkerProcess) (json.RawMessage, error) {
		close(started)
		<-finish
		return json.RawMessage(`{"manifest":{"targets":[],"evals":[]},"contentHash":"hash","writtenFiles":[]}`), nil
	}

	assertCommandKeepsProcessLogger(t, started, finish, func() error {
		cmd := NewRuntimeCmd(&cli.Factory{})
		cmd.SetArgs([]string{"--json", "--cwd", t.TempDir(), "generate"})
		cmd.SetOut(&strings.Builder{})
		cmd.SetErr(&strings.Builder{})
		return cmd.Execute()
	})
}

func TestSetupDoesNotReplaceProcessLogger(t *testing.T) {
	t.Setenv("CRUX_STARTUP_DEBUG", "")
	previousRunner := runSetupOperationForCommand
	t.Cleanup(func() { runSetupOperationForCommand = previousRunner })

	started := make(chan struct{})
	finish := make(chan struct{})
	runSetupOperationForCommand = func(context.Context, string, string, commandWorkerProcess) (json.RawMessage, error) {
		close(started)
		<-finish
		return json.RawMessage(`{"ok":true,"setup":{"ok":true,"mode":"check","findings":[],"actions":[],"applied":[]},"generation":{"status":"current","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pendingFiles":[],"changedFiles":[],"findings":[]}}`), nil
	}

	assertCommandKeepsProcessLogger(t, started, finish, func() error {
		cmd := NewSetupCmd(&cli.Factory{})
		cmd.SetArgs([]string{"--json", "--cwd", t.TempDir()})
		cmd.SetOut(&strings.Builder{})
		cmd.SetErr(&strings.Builder{})
		return cmd.Execute()
	})
}

func assertCommandKeepsProcessLogger(t *testing.T, started <-chan struct{}, finish chan<- struct{}, execute func() error) {
	t.Helper()
	previousLogger := slog.Default()
	var logOutput bytes.Buffer
	processLogger := slog.New(slog.NewTextHandler(&logOutput, nil))
	slog.SetDefault(processLogger)
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	done := make(chan error, 1)
	go func() { done <- execute() }()
	<-started
	slog.Info("concurrent process log")
	close(finish)
	if err := <-done; err != nil {
		t.Fatalf("execute command: %v", err)
	}
	if slog.Default() != processLogger {
		t.Fatal("command replaced the process-global logger")
	}
	if !strings.Contains(logOutput.String(), "concurrent process log") {
		t.Fatalf("concurrent process log was redirected by command: %q", logOutput.String())
	}
}
