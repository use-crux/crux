package main

import (
	"strings"
	"testing"
)

func TestPTYRootHelpExitsWithoutControlSequences(t *testing.T) {
	transcript := runCruxPTYHelp(t)

	for _, want := range []string{"Usage", "crux <command> [flags]"} {
		if !strings.Contains(transcript, want) {
			t.Fatalf("PTY help missing %q:\n%s", want, transcript)
		}
	}
	if strings.Contains(transcript, "\x1b") {
		t.Fatalf("PTY help contained a terminal escape sequence:\n%q", transcript)
	}
}

func TestPTYRootHelpNoColorFlagDisablesControlSequences(t *testing.T) {
	transcript := runCruxPTY(t,
		[]string{"--no-color", "--help"},
		[]string{"TERM=xterm-256color"},
	)

	if !strings.Contains(transcript, "crux <command> [flags]") {
		t.Fatalf("PTY help missing usage:\n%s", transcript)
	}
	if strings.Contains(transcript, "\x1b") {
		t.Fatalf("PTY help with --no-color contained a terminal escape sequence:\n%q", transcript)
	}
}
