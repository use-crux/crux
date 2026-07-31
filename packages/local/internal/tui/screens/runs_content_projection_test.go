package screens

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestProjectRunHeaderTable(t *testing.T) {
	tests := []struct {
		name   string
		detail api.ObservabilityRunDetail
		want   runHeaderContent
	}{
		{
			name: "mixed composition and abnormal badges",
			detail: api.ObservabilityRunDetail{
				Run: api.ObservabilityRunSummary{DeliveryHealth: &observability.RunDeliveryHealth{Status: "degraded", Rejected: 2}},
				Facets: map[string]map[string]int{
					"family": {"generation": 2, "tool": 1},
					"model":  {"gpt-5": 2, "gpt-4o-mini": 1},
				},
				Redaction: &observability.ObservabilityRedactionEvidence{
					Applied: true, Surfaces: []observability.ObservabilityRedactionSurface{
						observability.RedactionSurfaceArtifactPreview,
					},
				},
			},
			want: runHeaderContent{
				Composition: "generation 2 · tool",
				Models:      "2 models mixed",
				Delivery:    "degraded · 2 rejected",
				Redacted:    1,
			},
		},
		{
			name: "healthy chrome stays calm",
			detail: api.ObservabilityRunDetail{
				Run:    api.ObservabilityRunSummary{Model: "gpt-5", DeliveryHealth: &observability.RunDeliveryHealth{Status: "healthy"}},
				Facets: map[string]map[string]int{},
			},
			want: runHeaderContent{Models: "gpt-5"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := projectRunHeader(test.detail); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("header = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestPrimitiveContentProjections(t *testing.T) {
	t.Run("timing and token splits", func(t *testing.T) {
		node := api.ObservabilityRunDetailNode{
			Timing: observability.RunDetailTiming{SelfMs: 30, ChildrenMs: 70},
			MetricBuckets: observability.RunDetailMetricBuckets{
				Total: json.RawMessage(`{"inputTokens":80,"cacheReadTokens":20,"outputTokens":10}`),
			},
		}
		got := projectSpanSplits(node)
		if got.SelfMs != 30 || got.ChildrenMs != 70 || got.Input != 80 || got.Cache != 20 || got.Output != 10 {
			t.Fatalf("splits = %#v", got)
		}
	})

	t.Run("memory disposition", func(t *testing.T) {
		node := api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{
				Primitive: "memory.capture", MemoryID: "conversation",
				Attributes: json.RawMessage(`{"requestedMode":"deferred","disposition":"retained","outcome":"completed"}`),
			},
		}
		got := projectMemoryCapture(node)
		if got.RequestedMode != "deferred" || got.Disposition != "retained" || got.Outcome != "completed" {
			t.Fatalf("memory = %#v", got)
		}
	})

	t.Run("sanitized media descriptor", func(t *testing.T) {
		node := api.ObservabilityRunDetailNode{Artifacts: []observability.ArtifactSummary{{
			ArtifactID: "media-1", Kind: "output", ContentType: "application/json",
			Preview: json.RawMessage(`{"content":[{"kind":"image","mediaType":"image/png","sizeBytes":42,"sourceCategory":"asset-ref"}]}`),
		}}}
		got := projectMediaDescriptors(node)
		if len(got) != 1 || got[0].Kind != "image" || got[0].ContentType != "image/png" ||
			got[0].SizeBytes != 42 || got[0].Source != "asset-ref" || got[0].Lineage != "output · media-1" {
			t.Fatalf("media = %#v", got)
		}
	})
}

func TestFailurePathRowsKeepsOnlyFailuresAndAncestors(t *testing.T) {
	screen := NewRuns()
	screen.diagnosis = &RunDiagnosis{
		Summary: DiagnosisSummary{Status: "error"},
		Timeline: []RunRow{
			{ID: "root", Span: api.InspectRunSpan{ID: "root"}},
			{ID: "healthy", Span: api.InspectRunSpan{ID: "healthy", ParentID: "root"}},
			{ID: "branch", Span: api.InspectRunSpan{ID: "branch", ParentID: "root"}},
			{ID: "failed", Span: api.InspectRunSpan{ID: "failed", ParentID: "branch"}},
		},
		Failures: []FailureItem{{NodeID: "failed", Message: "boom"}},
	}
	got := screen.failurePathRows()
	ids := make([]string, len(got))
	for index := range got {
		ids[index] = got[index].ID
	}
	if want := []string{"root", "branch", "failed"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("failure path = %v, want %v", ids, want)
	}
}

func TestFailurePathMapsAttachedDetailToSelectableOwner(t *testing.T) {
	screen := NewRuns()
	screen.diagnosis = &RunDiagnosis{
		Summary: DiagnosisSummary{Status: "error"},
		Timeline: []RunRow{
			{ID: "root", Span: api.InspectRunSpan{ID: "root"}},
			{ID: "child", Span: api.InspectRunSpan{ID: "child", ParentID: "root"}},
		},
		Failures: []FailureItem{{NodeID: "detail-error", Message: "boom"}},
		Raw: api.ObservabilityRunDetail{Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "root"},
			Children: []api.ObservabilityRunDetailNode{{
				SpanSummary: api.ObservabilitySpanSummary{SpanID: "child"},
				Details: []observability.RunDetailDetail{{
					SpanSummary: api.ObservabilitySpanSummary{SpanID: "detail-error"},
				}},
			}},
		}},
	}
	if got := screen.failingSpanIDs(); !reflect.DeepEqual(got, []string{"child"}) {
		t.Fatalf("failing IDs = %v, want selectable child owner", got)
	}
	rows := screen.failurePathRows()
	if len(rows) != 2 {
		t.Fatalf("failure path rows = %#v, want root and child", rows)
	}
	if got := []string{rows[0].ID, rows[1].ID}; !reflect.DeepEqual(got, []string{"root", "child"}) {
		t.Fatalf("failure path = %v, want root and child", got)
	}
}
