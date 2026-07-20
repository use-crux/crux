package evalcmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestConfirmUnknownCostUsesInjectedInputAndErrorOutput(t *testing.T) {
	var stdout, stderr bytes.Buffer
	streams := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{
		In: strings.NewReader("yes\n"),
	})

	confirmed, err := confirmUnknownCost(streams)
	if err != nil {
		t.Fatalf("confirmUnknownCost() error = %v", err)
	}
	if !confirmed {
		t.Fatal("confirmUnknownCost() = false, want true from injected input")
	}
	if !strings.Contains(stderr.String(), "Continue? [y/N]") {
		t.Fatalf("prompt did not use injected error output: %q", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("prompt polluted injected stdout: %q", stdout.String())
	}
}
