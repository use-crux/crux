package commands

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestStatsRendererColorless(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printStats(io, api.Stats{
		TotalExecutions: 3,
		SuccessCount:    2,
		ErrorCount:      1,
		TotalTokens:     1200,
		TotalCost:       0.42,
	})

	got := out.String()
	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless stats output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"Overview", "Executions:", "✓ 2", "✗ 1", "Tokens:"} {
		if !strings.Contains(got, want) {
			t.Errorf("stats output missing %q:\n%s", want, got)
		}
	}
}
