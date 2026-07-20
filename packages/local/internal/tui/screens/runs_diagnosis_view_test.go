package screens

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestRunsRendersSemanticDiagnosisByDefaultAndRawOnlyOnAction(t *testing.T) {
	runs, rawMarker := semanticDiagnosisRuns()
	view := stripANSI(viewRunsForTest(runs, Size{Width: 100, Height: 50}))
	for _, want := range []string{
		"RUN SUMMARY", "failed", "2.50s", "DIAGNOSTICS", "model.timeout", "provider timed out",
		"check provider latency", "ARTIFACTS", "artifact-output", "EVENTS", "event-timeout",
		"DEFINITION REFS", "agent:support-v2",
	} {
		if !strings.Contains(view, want) {
			t.Errorf("semantic diagnosis missing %q:\n%s", want, view)
		}
	}
	if strings.Contains(view, rawMarker) {
		t.Fatalf("default diagnosis rendered raw-only evidence:\n%s", view)
	}
	fullDocument := stripANSI(runs.renderSpanDetailDocument(runs.currentSpan(), 74))
	for _, rawOnly := range []string{rawMarker, `{"artifactId"`, `{"eventId"`, `{"agentId"`} {
		if strings.Contains(fullDocument, rawOnly) {
			t.Fatalf("semantic document rendered raw storage shape %q:\n%s", rawOnly, fullDocument)
		}
	}

	cmd := runs.Update(testContext, tea.KeyPressMsg{Text: "i", Code: 'i'}, nil)
	if cmd == nil {
		t.Fatal("explicit inspect action returned no command")
	}
	request, ok := cmd().(InspectRequest)
	if !ok || !strings.Contains(string(request.Payload), rawMarker) {
		t.Fatalf("inspect request = %#v, want complete direct-node raw evidence", request)
	}
}

func TestRunsRendersAssociatedFailureAndOperationEvidence(t *testing.T) {
	runs := NewRuns()
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-child-failure", Status: "failed", DurationMs: 100},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "root", Name: "root activity", Status: "ok", DurationMs: 100},
			Children: []observability.RunDetailNode{{
				SpanSummary: api.ObservabilitySpanSummary{
					SpanID: "failed-tool", ParentSpanID: "root", Family: "tool", Primitive: "tool.call", Name: "search docs", Status: "failed",
					DurationMs: 80, Error: json.RawMessage(`{"message":"provider request failed"}`),
				},
				Events: []observability.SpanEventSummary{{EventID: "retry-1", Name: "retry.scheduled"}},
			}},
		},
	}
	setRunsForTest(runs, detail.Run)
	selectRunForTest(runs, detail.Run.RunID)
	setRunDetailForTest(runs, detail)

	view := stripANSI(viewRunsForTest(runs, Size{Width: 160, Height: 45}))
	document := stripANSI(runs.renderSpanDetailDocument(runs.currentSpan(), 70))
	for _, want := range []string{"CRITICAL PATH", "TIMING INFERENCE", "ATTENTION", "search docs", "failed status", "retry event", "FAILURE EVIDENCE", "provider request failed"} {
		if !strings.Contains(document, want) {
			t.Errorf("associated diagnosis missing %q:\n%s", want, document)
		}
	}
	if !strings.Contains(view, "failed · search docs") {
		t.Fatalf("waterfall did not expose failed operation status:\n%s", view)
	}

	selectSpanForTest(runs, "failed-tool")
	document = stripANSI(runs.renderSpanDetailDocument(runs.currentSpan(), 70))
	if !strings.Contains(document, "status") || !strings.Contains(document, "failed") {
		t.Fatalf("selected operation did not expose status:\n%s", document)
	}
}

func TestRunsWaterfallKeepsAbnormalStatusVisibleForLongNames(t *testing.T) {
	runs := NewRuns()
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-long-failure", Status: "failed", DurationMs: 100},
		Root: api.ObservabilityRunDetailNode{SpanSummary: api.ObservabilitySpanSummary{
			SpanID: "failed-long", Name: "an extraordinarily long operation name that must truncate", Status: "failed", DurationMs: 100,
		}},
	}
	setRunsForTest(runs, detail.Run)
	selectRunForTest(runs, detail.Run.RunID)
	setRunDetailForTest(runs, detail)
	runs.Resize(Size{Width: 160, Height: 24})

	waterfall := stripANSI(runs.renderWaterfall(98, 20))
	if !strings.Contains(waterfall, "failed · an extraordinar") {
		t.Fatalf("long abnormal row hid status:\n%s", waterfall)
	}
}

func TestRunsRendersRunDiagnosisWithoutTimelineRows(t *testing.T) {
	runs := NewRuns()
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-empty", Status: "failed", Error: json.RawMessage(`{"message":"run failed before activity began"}`)},
	}
	setRunsForTest(runs, detail.Run)
	selectRunForTest(runs, detail.Run.RunID)
	setRunDetailForTest(runs, detail)
	runs.setFocus(focusSpanDetail)

	view := stripANSI(viewRunsForTest(runs, Size{Width: 100, Height: 30}))
	if !strings.Contains(view, "RUN SUMMARY") || !strings.Contains(view, "run failed before activity began") {
		t.Fatalf("run-only diagnosis missing:\n%s", view)
	}
}

func TestRunsBoundsDefaultDiagnosisCollections(t *testing.T) {
	diagnosis := &RunDiagnosis{Summary: DiagnosisSummary{RunID: "run-large"}}
	for index := 0; index < maxDiagnosisItemsPerSection+3; index++ {
		diagnosis.Events = append(diagnosis.Events, EventItem{NodeID: "span-tool", Event: observability.SpanEventSummary{EventID: fmt.Sprintf("event-%02d", index)}})
	}

	rendered := stripANSI(renderDiagnosisOverview(diagnosis, 80))
	if strings.Contains(rendered, fmt.Sprintf("event-%02d", maxDiagnosisItemsPerSection)) || !strings.Contains(rendered, "+3 more") {
		t.Fatalf("diagnosis collection was not bounded:\n%s", rendered)
	}
}

func TestRunsSemanticDiagnosisGoldens(t *testing.T) {
	previousNow := relTimeNow
	relTimeNow = func() time.Time { return time.Date(2026, 7, 18, 21, 0, 0, 0, time.UTC) }
	defer func() { relTimeNow = previousNow }()

	for _, size := range []Size{{Width: 70, Height: 24}, {Width: 100, Height: 30}, {Width: 160, Height: 45}} {
		name := fmt.Sprintf("%dx%d", size.Width, size.Height)
		t.Run(name, func(t *testing.T) {
			runs, _ := semanticDiagnosisRuns()
			uitest.Golden(t, "runs-diagnosis-"+name, viewRunsForTest(runs, size))
		})
	}
}

func semanticDiagnosisRuns() (*Runs, string) {
	const rawMarker = "raw-support-marker-41f8"
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID: "run-failed", Name: "support-agent", Status: "failed", StartedAt: "2026-07-18T20:00:00Z", DurationMs: 2500, SpanCount: 1,
		},
		Diagnostics: []observability.RunDetailDiagnostic{{
			Code: "model.timeout", Severity: "error", Message: "provider timed out", SuggestedFix: "check provider latency",
		}},
		DefinitionRefs: []observability.DefinitionRef{{ID: "agent:support-v2", Kind: "agent", Role: "invoke"}},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID: "span-root", Family: "agent", Primitive: "agent.run", Status: "failed",
				Attributes: json.RawMessage(`{"rawOnlyMarker":"` + rawMarker + `"}`),
			},
			ID:        "span:span-root",
			Display:   observability.RunDetailDisplay{Kind: "agent.run", Label: "support agent"},
			Timing:    observability.RunDetailTiming{StartedAt: "2026-07-18T20:00:00Z", DurationMs: 2500},
			Artifacts: []observability.ArtifactSummary{{ArtifactID: "artifact-output", Kind: "output", SizeBytes: 42}},
			Events:    []observability.SpanEventSummary{{EventID: "event-timeout", Name: "model.timeout", Timestamp: "2026-07-18T20:00:02Z"}},
			Inspection: observability.RunDetailInspection{"support": {{
				Type: "debug", ID: "raw-only", Data: json.RawMessage(`{"marker":"` + rawMarker + `"}`),
			}}},
		},
	}
	runs := NewRuns()
	setRunsForTest(runs, detail.Run)
	selectRunForTest(runs, detail.Run.RunID)
	setRunDetailForTest(runs, detail)
	runs.setFocus(focusSpanDetail)
	return runs, rawMarker
}
