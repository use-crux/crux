//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || zos

package main

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestPTYDevFilterOwnsQBeforeWorkspaceQuit(t *testing.T) {
	session := startPTYDev(t)
	session.waitFor(t, "Overview", 20*time.Second)
	if err := session.write([]byte("3/q")); err != nil {
		t.Fatalf("type q in Runs filter: %v", err)
	}
	time.Sleep(150 * time.Millisecond)
	session.assertRunning(t)
	if err := session.write([]byte{'\r'}); err != nil {
		t.Fatalf("finish filter: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	if err := session.write([]byte{'q'}); err != nil {
		t.Fatalf("quit after leaving filter: %v", err)
	}
	session.waitExit(t, 0, 10*time.Second)
	session.assertTerminalRestored(t)
	session.assertPortReleased(t)
}

func TestPTYDevRendersSupportedTerminalWidths(t *testing.T) {
	for _, size := range []pty.Winsize{{Rows: 24, Cols: 70}, {Rows: 45, Cols: 160}} {
		name := strconv.Itoa(int(size.Cols)) + "x" + strconv.Itoa(int(size.Rows))
		t.Run(name, func(t *testing.T) {
			session := startPTYDevAtSize(t, size)
			session.waitFor(t, "Overview", 20*time.Second)
			transcript := session.output()
			if strings.Contains(strings.ToLower(transcript), "terminal too small") {
				t.Fatalf("supported terminal size rendered as unusable:\n%s", transcript)
			}
			if err := session.write([]byte("3")); err != nil {
				t.Fatalf("navigate to Runs: %v", err)
			}
			session.waitFor(t, "all time", 10*time.Second)
			if err := session.write([]byte("q")); err != nil {
				t.Fatalf("quit crux dev: %v", err)
			}
			session.waitExit(t, 0, 10*time.Second)
			session.assertTerminalRestored(t)
			session.assertPortReleased(t)
		})
	}
}
