package cli

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestExactArgsExplainsMissingArgumentsWithUsageAndExample(t *testing.T) {
	root := &cobra.Command{Use: "crux"}
	child := &cobra.Command{
		Use:     "diff <run-a> <run-b>",
		Example: "  crux eval diff run_before run_after",
		Args:    ExactArgs(2),
	}
	eval := &cobra.Command{Use: "eval"}
	eval.AddCommand(child)
	root.AddCommand(eval)

	err := child.Args(child, nil)
	if err == nil {
		t.Fatal("missing arguments succeeded")
	}
	for _, want := range []string{
		"missing required argument(s): <run-a> <run-b>",
		"Usage:\n  crux eval diff <run-a> <run-b>",
		"Example:\n  crux eval diff run_before run_after",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error = %q, want %q", err, want)
		}
	}
}
