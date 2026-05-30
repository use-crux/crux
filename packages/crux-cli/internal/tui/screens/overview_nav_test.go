package screens

import (
	"testing"

	"github.com/anthropics/crux-cli/internal/api"
	tea "github.com/charmbracelet/bubbletea"
)

// TestOverviewCursorCyclesInsights asserts j/k move a row cursor through
// the Top Insights panel and the selected insight id is observable via
// SelectedInsightID(). Overview is the workflow launchpad — see S6 in
// the implementation plan.
func TestOverviewCursorCyclesInsights(t *testing.T) {
	o := NewOverview()
	o.loaded = true
	o.insights = []api.QualityInsightRecord{
		{InsightID: "INS-1"},
		{InsightID: "INS-2"},
		{InsightID: "INS-3"},
	}

	if got := o.SelectedInsightID(); got != "INS-1" {
		t.Fatalf("initial SelectedInsightID = %q, want %q", got, "INS-1")
	}

	// `j` moves down.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := o.SelectedInsightID(); got != "INS-2" {
		t.Errorf("after j, SelectedInsightID = %q, want %q", got, "INS-2")
	}

	// `j` again → INS-3.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := o.SelectedInsightID(); got != "INS-3" {
		t.Errorf("after second j, SelectedInsightID = %q, want %q", got, "INS-3")
	}

	// `j` at end stays at the last row (bounded).
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := o.SelectedInsightID(); got != "INS-3" {
		t.Errorf("j at end should clamp; SelectedInsightID = %q, want %q", got, "INS-3")
	}

	// `k` moves up.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}}, nil)
	if got := o.SelectedInsightID(); got != "INS-2" {
		t.Errorf("after k, SelectedInsightID = %q, want %q", got, "INS-2")
	}
}

// TestOverviewLTogglesToRunsPanel asserts `l` toggles focus from the
// insights panel to the runs panel, and `j` afterwards moves the runs
// cursor (not the insights cursor).
func TestOverviewLTogglesToRunsPanel(t *testing.T) {
	o := NewOverview()
	o.loaded = true
	o.insights = []api.QualityInsightRecord{
		{InsightID: "INS-1"}, {InsightID: "INS-2"},
	}
	o.runs = []api.QualityRunRecord{
		{TraceID: "RUN-1"}, {TraceID: "RUN-2"}, {TraceID: "RUN-3"},
	}

	if got := o.SelectedRunID(); got != "RUN-1" {
		t.Fatalf("initial SelectedRunID = %q, want %q", got, "RUN-1")
	}

	// `l` → focus runs.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil)
	// `j` should move the runs cursor now, NOT the insights cursor.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)

	if got := o.SelectedRunID(); got != "RUN-2" {
		t.Errorf("after l+j, SelectedRunID = %q, want %q", got, "RUN-2")
	}
	if got := o.SelectedInsightID(); got != "INS-1" {
		t.Errorf("after l+j, insights cursor moved (got %q), should still be %q", got, "INS-1")
	}

	// `h` → focus back to insights.
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}}, nil)
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)

	if got := o.SelectedInsightID(); got != "INS-2" {
		t.Errorf("after h+j, SelectedInsightID = %q, want %q", got, "INS-2")
	}
	if got := o.SelectedRunID(); got != "RUN-2" {
		t.Errorf("after h+j, runs cursor moved (got %q), should still be %q", got, "RUN-2")
	}
}

// TestOverviewEnterOnInsightEmitsNavigateRequest asserts ↵ with the
// insights panel focused emits a NavigateRequest carrying the focused
// insight's id, so the workbench can stage it and jump to the Insights
// screen.
func TestOverviewEnterOnInsightEmitsNavigateRequest(t *testing.T) {
	o := NewOverview()
	o.loaded = true
	o.insights = []api.QualityInsightRecord{
		{InsightID: "INS-014"},
	}

	cmd := o.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter on focused insight returned nil cmd — expected a NavigateRequest emitter")
	}
	msg := cmd()
	req, ok := msg.(NavigateRequest)
	if !ok {
		t.Fatalf("Enter produced %T, want NavigateRequest", msg)
	}
	if req.NavID != "insights" {
		t.Errorf("NavigateRequest.NavID = %q, want %q", req.NavID, "insights")
	}
	if req.Kind != "insight" {
		t.Errorf("NavigateRequest.Kind = %q, want %q", req.Kind, "insight")
	}
	if req.ID != "INS-014" {
		t.Errorf("NavigateRequest.ID = %q, want %q", req.ID, "INS-014")
	}
}

// TestOverviewEnterOnRunEmitsNavigateRequest asserts ↵ with the runs
// panel focused emits a NavigateRequest carrying the focused run's id.
func TestOverviewEnterOnRunEmitsNavigateRequest(t *testing.T) {
	o := NewOverview()
	o.loaded = true
	o.runs = []api.QualityRunRecord{
		{TraceID: "8af2f1c"},
	}
	o.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil)

	cmd := o.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter on focused run returned nil cmd")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("Enter produced wrong type")
	}
	if req.NavID != "runs" || req.Kind != "run" || req.ID != "8af2f1c" {
		t.Errorf("NavigateRequest = %+v, want {NavID:runs Kind:run ID:8af2f1c}", req)
	}
}
