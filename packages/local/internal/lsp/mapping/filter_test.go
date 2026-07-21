package mapping

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestFilterFindingsUsesProfileAndSyntheticSuppression(t *testing.T) {
	findings := []api.IndexLintFinding{
		{ID: "recommended", Profiles: []string{"recommended"}},
		{ID: "strict", Profiles: []string{"strict"}},
		{ID: "suppressed", Profiles: []string{"strict"}, Suppressed: true},
	}
	filtered := FilterFindings(findings, FilterOptions{Profile: "strict"})
	if len(filtered) != 1 || filtered[0].ID != "strict" {
		t.Fatalf("strict filtered findings = %#v", filtered)
	}
	filtered = FilterFindings(findings, FilterOptions{Profile: "strict", IncludeSuppressed: true})
	if len(filtered) != 2 || filtered[1].ID != "suppressed" {
		t.Fatalf("included suppressed findings = %#v", filtered)
	}
	if got := FilterFindings(findings, FilterOptions{Profile: "off"}); len(got) != 0 || got == nil {
		t.Fatalf("off findings = %#v, want nonnil empty", got)
	}
}
