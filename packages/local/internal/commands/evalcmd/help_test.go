package evalcmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestEvalHelpExposesOnlyTheV1ProductSurface(t *testing.T) {
	cmd := New(&cli.Factory{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, want := range []string{
		"crux eval support", "run", "list", "show", "diff", "baseline",
		"--case", "--variant", "--watch", "--fresh", "--offline", "--plan", "--max-cost",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("eval help missing %q:\n%s", want, text)
		}
	}
	for _, forbidden := range []string{"replay", "rescore", "experiment", "cassette", "pin-id"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("eval help contains removed concept %q:\n%s", forbidden, text)
		}
	}
}
