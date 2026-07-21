package mapping

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestMapFindingsIsDeterministicAfterInputShuffle(t *testing.T) {
	mapper := New(Options{Root: "/workspace", ConfigFile: "/workspace/crux.config.ts"})
	columnOne, columnTwo := 1, 2
	findings := []api.IndexLintFinding{
		deterministicFinding("four", "z.rule", 2, &columnTwo),
		deterministicFinding("two", "z.rule", 1, &columnTwo),
		deterministicFinding("three", "a.rule", 2, &columnOne),
		deterministicFinding("one", "a.rule", 1, &columnTwo),
	}
	shuffled := []api.IndexLintFinding{findings[2], findings[0], findings[3], findings[1]}

	first, err := json.Marshal(mapper.MapFindings(findings)["file:///workspace/src/file.ts"])
	if err != nil {
		t.Fatal(err)
	}
	second, err := json.Marshal(mapper.MapFindings(shuffled)["file:///workspace/src/file.ts"])
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("shuffled diagnostics differ\nfirst:  %s\nsecond: %s", first, second)
	}
}

func TestResolveDocsURLPreservesAbsoluteHTTPLinks(t *testing.T) {
	for _, value := range []string{"https://example.com/rule", "http://localhost/rule"} {
		if got := ResolveDocsURL(value); got != value {
			t.Fatalf("ResolveDocsURL(%q) = %q", value, got)
		}
	}
}

func deterministicFinding(id, ruleID string, line int, column *int) api.IndexLintFinding {
	return api.IndexLintFinding{
		ID: id, RuleID: ruleID, Severity: "warning", Title: id,
		Source: &api.SourceLoc{File: "src/file.ts", Line: line, Column: column},
	}
}
