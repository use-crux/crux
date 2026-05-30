package components

import (
	"math"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Regression: when StartedAt is an absolute unix-ms timestamp (the actual
// shape produced by the backend) rather than a relative offset, the
// renderer must not panic — strings.Repeat would otherwise be called with
// an astronomically large count.
func TestWaterfallSurvivesAbsoluteTimestamps(t *testing.T) {
	dur := 1500.0
	traceStart := int64(1_778_790_044_000) // ms since epoch
	spans := []api.QualityRunSpan{
		{ID: "root", Kind: "trace", Name: "support_swarm", StartedAt: traceStart, DurationMs: &dur},
		{ID: "child", Kind: "tool", Name: "rag.search", ParentID: "root", StartedAt: traceStart + 200, DurationMs: &dur},
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Waterfall panicked: %v", r)
		}
	}()

	rows := FromAPISpans(spans, traceStart, "child")
	out := Waterfall(rows, 1500, 120)
	if out == "" {
		t.Fatal("expected non-empty waterfall output")
	}
	if strings.Contains(out, "panic") {
		t.Fatalf("waterfall output contained literal panic marker: %q", out)
	}
}

func TestWaterfallNoTraceStartFallsBackToMinSpan(t *testing.T) {
	dur := 100.0
	spans := []api.QualityRunSpan{
		{ID: "a", Name: "a", StartedAt: 5000, DurationMs: &dur},
		{ID: "b", Name: "b", StartedAt: 5100, DurationMs: &dur, ParentID: "a"},
	}
	rows := FromAPISpans(spans, 0, "")
	if rows[0].StartedMs != 0 {
		t.Errorf("expected first span at offset 0, got %v", rows[0].StartedMs)
	}
	if rows[1].StartedMs != 100 {
		t.Errorf("expected second span at offset 100, got %v", rows[1].StartedMs)
	}
}

func TestMakeBarClampsBogusFractions(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("makeBar panicked: %v", r)
		}
	}()
	_ = makeBar(40, 99.0, 99.0, "#ffffff", false)             // wildly out of range
	_ = makeBar(40, -10.0, -10.0, "#ffffff", false)           // negative
	_ = makeBar(40, math.NaN(), math.NaN(), "#ffffff", false) // NaN
}
