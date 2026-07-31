package screens

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

type insightsEvalErrorClient struct{ DataClient }

func (insightsEvalErrorClient) Insights(context.Context) ([]api.InspectInsightRecord, error) {
	return []api.InspectInsightRecord{{InsightID: "insight-1", Title: "Visible insight"}}, nil
}

func (insightsEvalErrorClient) EvalRuns(context.Context) ([]json.RawMessage, error) {
	return nil, errors.New("eval store unavailable")
}

func TestInsightsEvalEvidenceFailureKeepsInsightList(t *testing.T) {
	screen := NewInsights()
	client := insightsEvalErrorClient{}
	applyInsightsTestCommand(t, testContext, screen, screen.Init(testContext, client), client)

	if !screen.loaded || screen.err != "" || len(screen.items) != 1 {
		t.Fatalf("Eval-only failure hid Insights: loaded=%v err=%q items=%d", screen.loaded, screen.err, len(screen.items))
	}
	if screen.evalEvidenceErr == "" {
		t.Fatal("Eval-only failure was not retained for the Cases empty state")
	}
	view := stripANSI(screen.View(Size{Width: 70, Height: 20}))
	if !strings.Contains(view, "Visible insight") || strings.Contains(view, "error:") {
		t.Fatalf("Eval-only failure replaced the insight list:\n%s", view)
	}
}

func TestInsightsCasesExplicitIDUsesNewestRepresentativeCell(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = projectEvalRuns([]json.RawMessage{
		insightEvalRunJSON("old", 100, []any{
			insightEvalCellJSON("case-a", "current", 1, "passed", "old", ""),
		}),
		insightEvalRunJSON("new", 200, []any{
			insightEvalCellJSON("case-a", "current", 0, "passed", "pass", ""),
			insightEvalCellJSON("case-a", "current", 1, "failed", "fail", ""),
		}),
	})

	got := screen.linkedEvalCases(api.InspectInsightRecord{LinkedCaseIDs: []string{"case-a"}})
	if len(got) != 1 {
		t.Fatalf("linked cases = %#v, want one newest representative cell", got)
	}
	if got[0].RunID != "new" || got[0].Cell.Trial != 1 ||
		normalizeEvalCellStatus(got[0].Cell.Status) != "fail" {
		t.Fatalf("linked case = %#v, want newest failed representative trial", got[0])
	}
}

func TestInsightsCasesObservedRunDoesNotAttributeUnlinkedTrial(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = projectEvalRuns([]json.RawMessage{
		insightEvalRunJSON("eval-run", 200, []any{
			insightEvalCellJSON("case-observed", "candidate", 0, "passed", "passed", "trace-42"),
			insightEvalCellJSON("case-observed", "candidate", 1, "failed", "failed", ""),
		}),
	})

	got := screen.linkedEvalCases(api.InspectInsightRecord{LinkedTraceIDs: []string{"trace-42"}})
	if len(got) != 1 || got[0].Cell.CaseID != "case-observed" ||
		got[0].Cell.Trial != 0 || normalizeEvalCellStatus(got[0].Cell.Status) != "pass" {
		t.Fatalf("observed-run join = %#v, want exact linked passed trial", got)
	}
}

func TestInsightsCasesObservedRunPrefersFailureAmongMatchingTrials(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = projectEvalRuns([]json.RawMessage{
		insightEvalRunJSON("eval-run", 200, []any{
			insightEvalCellJSON("case-observed", "candidate", 0, "passed", "passed", "trace-42"),
			insightEvalCellJSON("case-observed", "candidate", 1, "failed", "failed", "trace-42"),
		}),
	})

	got := screen.linkedEvalCases(api.InspectInsightRecord{LinkedTraceIDs: []string{"trace-42"}})
	if len(got) != 1 || got[0].Cell.Trial != 1 ||
		normalizeEvalCellStatus(got[0].Cell.Status) != "fail" {
		t.Fatalf("multi-match observed join = %#v, want failed linked representative", got)
	}
}

func TestInsightsCasesSkipsAbsentSelectedCell(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = []evalRunItem{{
		RunID: "eval-run", EvalID: "quality", StartedAt: 200,
		Cases: []string{"case-a"}, Variants: []string{"candidate"},
		Cells: []evalCell{{CaseID: "case-a", Variant: "current", Status: "passed"}},
	}}
	insight := api.InspectInsightRecord{LinkedCaseIDs: []string{"case-a"}}

	if got := screen.linkedEvalCases(insight); len(got) != 0 {
		t.Fatalf("absent selected Case×Variant fabricated evidence: %#v", got)
	}
	view := stripANSI(strings.Join(screen.renderEvalCases(insight, 72, 8), "\n"))
	if !strings.Contains(view, "No linked eval case evidence yet") || strings.Contains(view, "not-run") {
		t.Fatalf("absent selected cell did not render an honest empty state:\n%s", view)
	}
}

func TestInsightsCasesMissingLinkRendersHonestEmpty(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = projectEvalRuns([]json.RawMessage{
		insightEvalRunJSON("eval-run", 200, []any{
			insightEvalCellJSON("recorded-case", "current", 0, "passed", "passed", ""),
		}),
	})
	insight := api.InspectInsightRecord{LinkedCaseIDs: []string{"unresolved-case"}}

	view := stripANSI(strings.Join(screen.renderEvalCases(insight, 72, 8), "\n"))
	if !strings.Contains(view, "No linked eval case evidence yet") {
		t.Fatalf("missing join omitted honest empty state:\n%s", view)
	}
	if strings.Contains(view, "unresolved-case") {
		t.Fatalf("missing join rendered a bare unresolved ID:\n%s", view)
	}
}

func TestInsightsCasesSuppressesAmbiguousIDsUntilTraceDisambiguates(t *testing.T) {
	screen := NewInsights()
	screen.evalRuns = []evalRunItem{
		{
			RunID: "run-a", EvalID: "eval-a", StartedAt: 200,
			Cases: []string{"happy-path"}, Variants: []string{"current"},
			Cells: []evalCell{{
				CaseID: "happy-path", Variant: "current", Status: "passed", RunIDs: []string{"trace-a"},
			}},
		},
		{
			RunID: "run-b", EvalID: "eval-b", StartedAt: 300,
			Cases: []string{"happy-path"}, Variants: []string{"current"},
			Cells: []evalCell{{
				CaseID: "happy-path", Variant: "current", Status: "failed", RunIDs: []string{"trace-b"},
			}},
		},
	}

	if got := screen.linkedEvalCases(api.InspectInsightRecord{
		LinkedCaseIDs: []string{"happy-path"},
	}); len(got) != 0 {
		t.Fatalf("ambiguous bare Case ID joined unrelated Evals: %#v", got)
	}

	got := screen.linkedEvalCases(api.InspectInsightRecord{
		LinkedCaseIDs:  []string{"happy-path"},
		LinkedTraceIDs: []string{"trace-b"},
	})
	if len(got) != 1 || got[0].EvalID != "eval-b" || got[0].Cell.Status != "failed" {
		t.Fatalf("trace-disambiguated Case join = %#v, want eval-b failure", got)
	}
}

func TestInsightsCasesRenderBodiesSafelyAndWithinBounds(t *testing.T) {
	score := 0.62
	screen := NewInsights()
	screen.evalRuns = []evalRunItem{{
		RunID: "eval-run", EvalID: "quality", StartedAt: 200,
		Cases: []string{"case-a"}, Variants: []string{"candidate"},
		Cells: []evalCell{{
			CaseID: "case-a", Variant: "candidate", Trial: 0, Status: "failed",
			Input:    map[string]any{"question": "\x1b]52;c;unsafe\a Can I\nrefund?"},
			Expected: map[string]any{"verdict": "passed"},
			Output:   map[string]any{"verdict": "failed"},
			Scores:   []evalCellScore{{Name: "quality", Value: &score, Status: "computed"}},
		}},
	}}
	insight := api.InspectInsightRecord{LinkedCaseIDs: []string{"case-a"}}

	const width, height = 56, 9
	rendered := screen.renderEvalCases(insight, width, height)
	if len(rendered) != height {
		t.Fatalf("lines = %d, want %d", len(rendered), height)
	}
	for index, line := range rendered {
		if got := lipgloss.Width(line); got != width {
			t.Fatalf("line %d width = %d, want %d: %q", index, got, width, line)
		}
	}
	view := stripANSI(strings.Join(rendered, "\n"))
	for _, want := range []string{
		"case-a", `question=" Can I refund?"`, `expected "passed"`, `actual "failed"`,
		"quality · 0.62 · computed",
	} {
		if !strings.Contains(view, want) {
			t.Fatalf("case body omitted %q:\n%s", want, view)
		}
	}
	for _, unsafe := range []string{"\x1b", "\a", "\nrefund"} {
		if strings.Contains(view, unsafe) {
			t.Fatalf("case body retained unsafe payload %q:\n%s", unsafe, view)
		}
	}
}

func TestInsightsCasesProjectsAndRendersScalarPayloads(t *testing.T) {
	runs := projectEvalRuns([]json.RawMessage{evalTestJSON(map[string]any{
		"runId": "scalar-run", "evalId": "scalar-eval", "startedAt": 300,
		"selection": map[string]any{"cases": []string{"scalar-case", "array-case"}, "variants": []string{"current"}},
		"cells": []any{
			map[string]any{
				"caseId": "scalar-case", "variant": "current", "trial": 0, "status": "failed",
				"input": "plain input", "expected": true, "output": "wrong",
			},
			map[string]any{
				"caseId": "array-case", "variant": "current", "trial": 0, "status": "passed",
				"input": []any{"one", 2}, "expected": nil, "output": []any{"one", 2},
			},
		},
	})})
	if len(runs) != 1 || len(runs[0].Cells) != 2 || runs[0].Cells[1].Expected != nil {
		t.Fatalf("scalar Eval payload made the run unprojectable: %#v", runs)
	}

	screen := NewInsights()
	screen.evalRuns = runs
	view := stripANSI(strings.Join(screen.renderEvalCases(
		api.InspectInsightRecord{LinkedCaseIDs: []string{"scalar-case"}}, 80, 8,
	), "\n"))
	for _, want := range []string{`input  "plain input"`, "expected true", `actual "wrong"`} {
		if !strings.Contains(view, want) {
			t.Fatalf("scalar case body omitted %q:\n%s", want, view)
		}
	}
}

func TestInsightEvalValuePreservesJSONScalarTypes(t *testing.T) {
	if got := insightEvalValue(""); got != `""` {
		t.Fatalf("empty string = %q, want JSON empty string", got)
	}
	if text, boolean := insightEvalValue("true"), insightEvalValue(true); text != `"true"` || boolean != "true" || text == boolean {
		t.Fatalf("JSON scalar fidelity lost: string=%q bool=%q", text, boolean)
	}
}

func TestInsightsOwnsInsightAndEvalFreshness(t *testing.T) {
	screen := NewInsights()
	var _ ResourceScreen = screen
	invalidations := screen.Deactivate()
	if _, ok := invalidations.Revision(bridge.InsightsEvalRunsResource); !ok || len(invalidations) != 1 {
		t.Fatalf("Insights did not mark focus-scoped Eval evidence stale: %#v", invalidations)
	}
}

func insightEvalRunJSON(runID string, startedAt int64, cells []any) json.RawMessage {
	first := cells[0].(map[string]any)
	return evalTestJSON(map[string]any{
		"runId": runID, "evalId": "quality", "startedAt": startedAt,
		"selection": map[string]any{
			"cases": []string{first["caseId"].(string)}, "variants": []string{first["variant"].(string)},
		},
		"cells": cells,
	})
}

func insightEvalCellJSON(caseID, variant string, trial int, status, verdict, runID string) map[string]any {
	runIDs := []string{}
	if runID != "" {
		runIDs = append(runIDs, runID)
	}
	return map[string]any{
		"caseId": caseID, "variant": variant, "trial": trial, "status": status,
		"input": map[string]any{"question": caseID}, "expected": map[string]any{"verdict": "passed"},
		"output": map[string]any{"verdict": verdict}, "runIds": runIDs,
	}
}
