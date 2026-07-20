//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || zos

package main

import (
	"bufio"
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNPMWrapperSourceIsExecutable(t *testing.T) {
	wrapperInfo, err := os.Stat(filepath.Join("..", "..", "npm", "local", "bin", "crux.cjs"))
	if err != nil {
		t.Fatalf("stat npm wrapper: %v", err)
	}
	if wrapperInfo.Mode().Perm()&0o100 == 0 {
		t.Fatalf("npm wrapper mode = %04o, want executable", wrapperInfo.Mode().Perm())
	}
}

func TestNPMWrapperReplacesItselfAndWaitsForCleanup(t *testing.T) {
	wrapperSource, err := os.ReadFile(filepath.Join("..", "..", "npm", "local", "bin", "crux.cjs"))
	if err != nil {
		t.Fatalf("read npm wrapper: %v", err)
	}
	root := t.TempDir()
	wrapperPath := filepath.Join(root, "npm", "local", "bin", "crux.cjs")
	if err := os.MkdirAll(filepath.Dir(wrapperPath), 0o755); err != nil {
		t.Fatalf("mkdir wrapper layout: %v", err)
	}
	if err := os.WriteFile(wrapperPath, wrapperSource, 0o755); err != nil {
		t.Fatalf("write npm wrapper: %v", err)
	}
	exitStatusSource, err := os.ReadFile(filepath.Join("..", "..", "npm", "local", "bin", "child-exit-status.cjs"))
	if err != nil {
		t.Fatalf("read npm wrapper exit status helper: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(wrapperPath), "child-exit-status.cjs"), exitStatusSource, 0o644); err != nil {
		t.Fatalf("write npm wrapper exit status helper: %v", err)
	}
	childPath := filepath.Join(root, "crux")
	childSource := `#!/usr/bin/env node
const fs = require("node:fs")
process.on("SIGINT", () => {
  fs.writeSync(1, "CLEANUP\n")
  process.exit(130)
})
fs.writeSync(1, ` + "`" + `PID=${process.pid}\n` + "`" + `)
setInterval(() => {}, 1000)
`
	if err := os.WriteFile(childPath, []byte(childSource), 0o755); err != nil {
		t.Fatalf("write controllable child: %v", err)
	}

	command := exec.Command("node", wrapperPath)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("wrapper stdout: %v", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start npm wrapper: %v", err)
	}
	var childPID int
	t.Cleanup(func() {
		_ = command.Process.Kill()
		if childPID > 0 && childPID != command.Process.Pid {
			if child, findErr := os.FindProcess(childPID); findErr == nil {
				_ = child.Kill()
			}
		}
	})

	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatalf("wrapper did not report child PID: %v; stderr=%s", scanner.Err(), stderr.String())
	}
	pidText := strings.TrimPrefix(scanner.Text(), "PID=")
	childPID, err = strconv.Atoi(pidText)
	if err != nil {
		t.Fatalf("parse child PID from %q: %v", scanner.Text(), err)
	}
	if childPID != command.Process.Pid {
		t.Fatalf("child PID = %d, wrapper PID = %d; wrapper did not replace itself", childPID, command.Process.Pid)
	}
	cleanupRead := make(chan bool, 1)
	go func() {
		cleanupSeen := false
		for scanner.Scan() {
			if scanner.Text() == "CLEANUP" {
				cleanupSeen = true
			}
		}
		cleanupRead <- cleanupSeen
	}()

	if err := command.Process.Signal(os.Interrupt); err != nil {
		t.Fatalf("signal wrapper: %v", err)
	}
	waited := make(chan error, 1)
	go func() { waited <- command.Wait() }()
	var waitErr error
	select {
	case waitErr = <-waited:
	case <-time.After(3 * time.Second):
		t.Fatal("npm wrapper did not exit after child cleanup")
	}
	cleanupSeen := <-cleanupRead
	if !cleanupSeen {
		t.Fatalf("child cleanup output missing; wait=%v scan=%v stderr=%s", waitErr, scanner.Err(), stderr.String())
	}
	var exitErr *exec.ExitError
	if !errors.As(waitErr, &exitErr) || exitErr.ExitCode() != 130 {
		t.Fatalf("wrapper wait error = %v, want exit 130; stderr=%s", waitErr, stderr.String())
	}
}
