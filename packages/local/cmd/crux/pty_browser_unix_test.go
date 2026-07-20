//go:build linux || darwin

package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPTYDevBrowserRequiresExplicitOpen(t *testing.T) {
	tests := []struct {
		name  string
		args  []string
		calls int
	}{
		{name: "default", calls: 0},
		{name: "explicit open", args: []string{"--open"}, calls: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binDirectory := t.TempDir()
			marker := filepath.Join(t.TempDir(), "browser-calls")
			command := "xdg-open"
			if runtime.GOOS == "darwin" {
				command = "open"
			}
			script := "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$CRUX_BROWSER_MARKER\"\n"
			if err := os.WriteFile(filepath.Join(binDirectory, command), []byte(script), 0o755); err != nil {
				t.Fatalf("write browser stub: %v", err)
			}

			session := startPTYDevWithOptions(t, test.args, map[string]string{
				"PATH":                binDirectory + string(os.PathListSeparator) + os.Getenv("PATH"),
				"CRUX_BROWSER_MARKER": marker,
			})
			session.waitFor(t, "Overview", 20*time.Second)
			if err := session.write([]byte("q")); err != nil {
				t.Fatalf("quit crux dev: %v", err)
			}
			session.waitExit(t, 0, 10*time.Second)

			contents, err := os.ReadFile(marker)
			if err != nil && !os.IsNotExist(err) {
				t.Fatalf("read browser calls: %v", err)
			}
			calls := strings.Fields(string(contents))
			if len(calls) != test.calls {
				t.Fatalf("browser calls = %d, want %d: %q", len(calls), test.calls, contents)
			}
			if test.calls == 1 && !strings.HasPrefix(calls[0], "http://localhost:") {
				t.Fatalf("browser URL = %q", calls[0])
			}
		})
	}
}

func TestPTYDevWorkspaceOpenBrowserIsExplicitAndNonFatal(t *testing.T) {
	tests := []struct {
		name        string
		exitStatus  string
		wantFailure bool
	}{
		{name: "success"},
		{name: "failure", exitStatus: "exit 7", wantFailure: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binDirectory := t.TempDir()
			marker := filepath.Join(t.TempDir(), "browser-calls")
			command := "xdg-open"
			if runtime.GOOS == "darwin" {
				command = "open"
			}
			script := "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$CRUX_BROWSER_MARKER\"\n" + test.exitStatus + "\n"
			if err := os.WriteFile(filepath.Join(binDirectory, command), []byte(script), 0o755); err != nil {
				t.Fatalf("write browser stub: %v", err)
			}

			session := startPTYDevWithOptions(t, nil, map[string]string{
				"PATH":                binDirectory + string(os.PathListSeparator) + os.Getenv("PATH"),
				"CRUX_BROWSER_MARKER": marker,
			})
			session.waitFor(t, "Overview", 20*time.Second)
			if err := session.write([]byte("o")); err != nil {
				t.Fatalf("open browser from TUI: %v", err)
			}
			waitForBrowserCalls(t, marker, 1, 5*time.Second)
			if test.wantFailure {
				session.waitFor(t, "browser launch failed", 5*time.Second)
				session.assertRunning(t)
			}
			if err := session.write([]byte("q")); err != nil {
				t.Fatalf("quit crux dev: %v", err)
			}
			session.waitExit(t, 0, 10*time.Second)
			contents, err := os.ReadFile(marker)
			if err != nil {
				t.Fatalf("read browser calls: %v", err)
			}
			if calls := strings.Fields(string(contents)); len(calls) != 1 {
				t.Fatalf("browser calls = %d, want 1: %q", len(calls), contents)
			}
		})
	}
}

func waitForBrowserCalls(t *testing.T, marker string, want int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		contents, err := os.ReadFile(marker)
		if err == nil && len(strings.Fields(string(contents))) >= want {
			return
		}
		if err != nil && !os.IsNotExist(err) {
			t.Fatalf("read browser calls: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d browser call(s)", want)
}
