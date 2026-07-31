package commands

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestTUIProgramUsesInjectedInputAndOutput(t *testing.T) {
	client := &commandRootContextClient{
		FixtureClient: uitest.NewFixtureClient(),
		observed:      make(chan bool, 1),
	}
	app := newTUIApp(context.Background(), "http://localhost:4400", client, newStartupTracker(false))
	app.MarkBootComplete()
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{
		In: strings.NewReader("q"), StdinTTY: true, StdoutTTY: true, Term: "xterm-256color",
	})

	program := newTUIProgram(streams, app)
	app.SetProgram(program)
	if _, err := program.Run(); err != nil {
		t.Fatalf("run TUI program: %v", err)
	}
	if out.Len() == 0 {
		t.Fatal("TUI program did not render to injected output")
	}
}

func TestIngestTokenHintPrintsPathWithoutSecret(t *testing.T) {
	var errOut bytes.Buffer
	streams := output.NewTestIO(&bytes.Buffer{}, &errOut, output.TestIOOptions{})
	const (
		token     = "secret-ingest-token"
		tokenPath = ".crux/devtools/ingest-token"
	)

	printIngestTokenHint(streams, token, tokenPath)

	got := errOut.String()
	if strings.Contains(got, token) {
		t.Fatalf("ingest token hint leaked secret bytes: %q", got)
	}
	for _, want := range []string{"ingest token " + tokenPath, "cat " + tokenPath} {
		if !strings.Contains(got, want) {
			t.Fatalf("ingest token hint = %q, want %q", got, want)
		}
	}
}
