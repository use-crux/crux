package uitest

import "testing"

func TestFixtureClientRunDetail(t *testing.T) {
	client := NewFixtureClient()
	detail, found, err := client.RunDetail(nil, "8af2f1c")
	if err != nil {
		t.Fatalf("RunDetail returned error: %v", err)
	}
	if !found {
		t.Fatal("RunDetail did not find fixture trace 8af2f1c")
	}
	if len(detail.Spans) < 8 {
		t.Fatalf("RunDetail spans = %d, want a mockup-shaped trace", len(detail.Spans))
	}
	hasLinkedInsight := false
	hasDuplicate := false
	for _, span := range detail.Spans {
		if len(span.LinkedInsightIDs) > 0 {
			hasLinkedInsight = true
		}
		if span.Duplicate {
			hasDuplicate = true
		}
	}
	if !hasLinkedInsight {
		t.Fatal("RunDetail fixture has no linked insight span")
	}
	if !hasDuplicate {
		t.Fatal("RunDetail fixture has no duplicate span")
	}
}
