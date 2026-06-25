package lint

import (
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestParseSuppressionsPreparesSupportedDirectives(t *testing.T) {
	got := ParseSuppressions(
		"/repo/src/workflow.ts",
		strings.Join([]string{
			"workflow();",
			"// crux-lint-disable-next-line @acme/rules/require-owner -- fixture",
			"workflow();",
			"// crux-lint-disable-file prompt.missing_input_schema",
		}, "\n"),
	)
	want := []protocol.LintSuppression{
		{
			File:   "/repo/src/workflow.ts",
			Line:   2,
			Column: 4,
			Scope:  "next-line",
			RuleID: "@acme/rules/require-owner",
		},
		{
			File:   "/repo/src/workflow.ts",
			Line:   4,
			Column: 4,
			Scope:  "file",
			RuleID: "prompt.missing_input_schema",
		},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("suppressions = %+v, want %+v", got, want)
	}
}
