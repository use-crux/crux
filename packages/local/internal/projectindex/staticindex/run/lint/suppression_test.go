package lint

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestParseSuppressionsRetainsReason(t *testing.T) {
	got := ParseSuppressions(
		"/repo/src/workflow.ts",
		"// crux-lint-disable-next-line rule.id -- because\nworkflow();",
	)
	want := []protocol.LintSuppression{{
		File:   "/repo/src/workflow.ts",
		Line:   1,
		Column: 4,
		Scope:  "next-line",
		RuleID: "rule.id",
		Reason: "because",
	}}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("suppressions = %+v, want %+v", got, want)
	}
}

func TestParseSuppressionsRejectsScopePrefixes(t *testing.T) {
	got := ParseSuppressions(
		"/repo/src/workflow.ts",
		"// crux-lint-disable-next-lineage rule.id",
	)

	if len(got) != 0 {
		t.Fatalf("suppressions = %+v, want malformed scope prefix ignored", got)
	}
}

func TestParseSuppressionsHandlesReasonAndScopeGrammar(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   protocol.LintSuppression
	}{
		{
			name:   "reason omitted",
			source: "// crux-lint-disable-file rule.id",
			want:   protocol.LintSuppression{Scope: "file", RuleID: "rule.id"},
		},
		{
			name:   "outer whitespace trimmed and inner delimiters preserved",
			source: "// crux-lint-disable-line rule.id --   external -- ticket 1  ",
			want:   protocol.LintSuppression{Scope: "line", RuleID: "rule.id", Reason: "external -- ticket 1"},
		},
		{
			name:   "CRLF trimmed",
			source: "// crux-lint-disable-next-line rule.id -- because\r\nvalue();",
			want:   protocol.LintSuppression{Scope: "next-line", RuleID: "rule.id", Reason: "because"},
		},
		{
			name:   "ASCII rule grammar retained",
			source: "// crux-lint-disable-line @acme/rules.require_owner-v2",
			want:   protocol.LintSuppression{Scope: "line", RuleID: "@acme/rules.require_owner-v2"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ParseSuppressions("/repo/src/workflow.ts", test.source)
			if len(got) != 1 {
				t.Fatalf("suppressions = %+v, want one directive", got)
			}
			test.want.File = "/repo/src/workflow.ts"
			test.want.Line = 1
			test.want.Column = 4
			if !reflect.DeepEqual(got[0], test.want) {
				t.Fatalf("suppression = %+v, want %+v", got[0], test.want)
			}
		})
	}
}

func TestParseSuppressionsIgnoresMalformedDirectives(t *testing.T) {
	source := strings.Join([]string{
		"// crux-lint-disable-block rule.id",
		"// crux-lint-disable-line",
		"// crux-lint-disable-file !invalid",
	}, "\n")

	if got := ParseSuppressions("/repo/src/workflow.ts", source); len(got) != 0 {
		t.Fatalf("suppressions = %+v, want malformed directives ignored", got)
	}
}

func TestSuppressionsFromFilesSortsCallerInputWithoutMutatingIt(t *testing.T) {
	root := t.TempDir()
	aFile := filepath.Join(root, "a.ts")
	zFile := filepath.Join(root, "z.ts")
	for file, source := range map[string]string{
		aFile: "// crux-lint-disable-file rule.a",
		zFile: "// crux-lint-disable-file rule.z",
	} {
		if err := os.WriteFile(file, []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	files := []string{zFile, aFile}

	got := SuppressionsFromFiles(files)
	if len(got) != 2 || got[0].File != aFile || got[1].File != zFile {
		t.Fatalf("suppressions = %+v, want deterministic file order", got)
	}
	if !reflect.DeepEqual(files, []string{zFile, aFile}) {
		t.Fatalf("files = %v, want caller order preserved", files)
	}
}

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
			Reason: "fixture",
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
