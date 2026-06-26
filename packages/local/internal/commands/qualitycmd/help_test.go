package qualitycmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestQualityHelpExplainsSourceEvaluationWorkflow(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	cmd := New(&cli.Factory{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("quality help error: %v\n%s", err, out.String())
	}

	text := out.String()
	for _, want := range []string{
		"Quality is the canonical Crux evaluation surface.",
		"Source-defined evaluate(...) checks are discovered as evaluations.",
		"immutable Experiment records",
		"crux quality run",
		"crux quality progress <evaluation-id>",
		"crux quality cell-evidence <experiment-id>",
		"Run source-defined evaluations and write experiment records",
		"List discovered source-defined evaluations",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("quality help missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "crux eval") || strings.Contains(text, "Compatibility") {
		t.Fatalf("quality help still advertises legacy eval wording:\n%s", text)
	}
}
